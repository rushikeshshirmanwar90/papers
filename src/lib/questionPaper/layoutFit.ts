import { loadPdfjs } from "@/lib/pdfjsNode";

// Keeps a printed paper inside its columns. The HTML is built with every
// formula already cut at valid places (mathBreak.ts); this module then
//   1. measures the real layout in Chrome, at the printed width, and fixes what
//      does not fit: options that crowd are stacked, an equation still wider
//      than its column is scaled down (that equation only), figures are held
//      to the column, and the answer key's boxes grow to hold their answers;
//   2. re-measures, and reports what is still wrong;
//   3. checks the finished PDF for anything outside the page frame, questions
//      or figures that are missing, and empty pages.
// Problems are reported, never clipped away silently.

/** Page geometry in mm: the @page margins, which the frame is drawn on. */
export const PAGE_MARGIN_MM = { top: 6, side: 6, bottom: 12 };
/** The text sits this far inside the frame. */
export const TEXT_INSET_MM = 3;

const A4_MM = { width: 210, height: 297 };
const MM_TO_PX = 96 / 25.4;
const MM_TO_PT = 72 / 25.4;

/** The print layout's width in CSS px, so Chrome measures the columns at the width they print at. */
export const PRINT_VIEWPORT_WIDTH_PX = Math.floor((A4_MM.width - 2 * PAGE_MARGIN_MM.side) * MM_TO_PX);

export interface LayoutIssue {
  /** An error means the PDF has something wrong in it; a warning is for the teacher to look at. */
  severity: "error" | "warning";
  kind: string;
  /** "Question 14", "Question 14 (solutions)", "Answer key" … */
  where: string;
  detail: string;
}

export interface LayoutReport {
  issues: LayoutIssue[];
  stats: {
    equations: number;
    equationsScaled: number;
    optionsStacked: number;
    figures: number;
    /** Figures that print as images; SVG ones print as vector shapes. */
    rasterFigures: number;
    keysResized: number;
    pages: number;
  };
}

/** What Chrome's measuring pass returns. */
export interface FitResult {
  issues: LayoutIssue[];
  stats: Omit<LayoutReport["stats"], "pages">;
}

/**
 * Runs in the page (through page.evaluate, so the page itself keeps running no
 * scripts). Plain JavaScript in a string so no bundler can rewrite it.
 */
export const FIT_SCRIPT = String.raw`(() => {
  const MIN_SCALE = 0.7;      // below this a scaled equation is reported as a warning
  const MIN_READABLE = 0.5;   // below this it is an error: body text would print under 5 pt
  const MIN_FIGURE = 0.35;    // below this a figure is reported as small
  const issues = [];
  const stats = { equations: 0, equationsScaled: 0, optionsStacked: 0, figures: 0, rasterFigures: 0, keysResized: 0 };
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const num = (value) => parseFloat(value) || 0;
  const inner = (el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight);
  };
  const HOLDER = '.stem, .option, .solution-body, .solution-head, .source, .key > div, .section-title span, .field span, .heading, .institute';
  const holderOf = (el) => el.closest(HOLDER);
  const where = (el) => {
    const part = el.closest('.part');
    const kind = part ? part.getAttribute('data-part') : '';
    const question = el.closest('.question');
    const number = question && question.querySelector('.number');
    if (number) return 'Question ' + number.textContent.replace(/[()]/g, '') + (kind === 'solutions' ? ' (solutions)' : '');
    if (el.closest('.key-block')) return 'Answer key';
    return 'Paper header';
  };
  const add = (severity, kind, el, detail) => issues.push({ severity, kind, where: where(el), detail });
  const mathUnits = (root) => $$('.mseg', root).concat($$('math', root).filter((m) => !m.closest('.mseg')));
  const widthOf = (el) => el.getBoundingClientRect().width;
  // A formula's own box can be narrower than what it draws (Chrome sizes an
  // inline math box to its line), so measure how far its parts actually reach.
  const naturalOf = (el) => {
    const box = el.getBoundingClientRect();
    let right = box.right;
    for (const part of el.querySelectorAll('*')) {
      const r = part.getBoundingClientRect();
      if (r.width || r.height) right = Math.max(right, r.right);
    }
    return Math.max(box.width, right - box.left);
  };

  // ── Long formulas: one that wrapped (a piece starts left of the one before) gets room between its lines ──
  for (const split of $$('.msplit')) {
    const lefts = $$('math', split).map((m) => m.getBoundingClientRect().left);
    if (lefts.some((left, i) => i > 0 && left < lefts[i - 1] - 1)) split.classList.add('wrapped');
  }

  // ── Options: two to a row only while every option fits its half ─────────
  for (const options of $$('.options.short')) {
    let crowded = false;
    for (const option of $$('.option', options)) {
      const room = inner(option);
      if (mathUnits(option).some((m) => naturalOf(m) > room + 0.5)) crowded = true;
      if ($$('img', option).some((img) => widthOf(img) > room + 0.5)) crowded = true;
      const size = num(getComputedStyle(option).fontSize);
      const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest('math, .mark')) continue;
        // A word longer than the half it sits in would have to be broken mid-word.
        if (node.textContent.split(/\s+/).some((word) => word.length * size * 0.56 > room)) crowded = true;
      }
    }
    if (crowded) {
      options.classList.remove('short');
      stats.optionsStacked++;
    }
  }

  // ── Equations: scale only an equation that is still wider than its column ─
  for (const unit of mathUnits()) {
    stats.equations++;
    const holder = holderOf(unit);
    if (!holder) continue;
    const room = inner(holder);
    let scale = 1;
    for (let pass = 0; pass < 5; pass++) {
      const width = naturalOf(unit);
      if (width <= room + 0.5) break;
      scale *= room / width;
      unit.style.zoom = String(scale);
    }
    if (scale < 1) {
      stats.equationsScaled++;
      const percent = Math.round(scale * 100);
      if (naturalOf(unit) > room + 1) {
        add('error', 'equation-overflow', unit, 'An equation is still wider than its column.');
      } else if (scale < MIN_READABLE) {
        add('error', 'equation-unreadable', unit, 'An equation has no place to break and would need ' + percent + '% scaling to fit its column, too small to read. Split it into steps.');
      } else if (scale < MIN_SCALE) {
        add('warning', 'equation-too-wide', unit, 'An equation has no place to break and was scaled to ' + percent + '% to fit its column.');
      }
    }
  }

  // ── Figures: held to the column, proportions kept ──────────────────────────
  for (const img of $$('img.figure')) {
    stats.figures++;
    const svg = /^data:image\/svg/i.test(img.getAttribute('src') || '');
    if (!svg) stats.rasterFigures++;
    if (!img.complete || (!img.naturalWidth && !svg) || !widthOf(img)) {
      add('error', 'figure-broken', img, 'A figure did not decode.');
      continue;
    }
    const room = inner(img.parentElement);
    if (widthOf(img) > room + 0.5) {
      img.style.width = room + 'px';
      img.style.height = 'auto';
    }
    const box = img.getBoundingClientRect();
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (Math.abs(box.width / box.height - ratio) / ratio > 0.02) {
        img.style.width = 'auto';
        img.style.height = 'auto';
        const again = img.getBoundingClientRect();
        if (Math.abs(again.width / again.height - ratio) / ratio > 0.02) add('error', 'figure-distorted', img, 'A figure could not keep its proportions.');
      }
      const shown = img.getBoundingClientRect().width / img.naturalWidth;
      if (shown < MIN_FIGURE) add('warning', 'figure-small', img, 'A wide figure is shown at ' + Math.round(shown * 100) + '% of its size and may be hard to read.');
    }
    if (widthOf(img) > room + 1) add('error', 'figure-overflow', img, 'A figure is still wider than its column.');
  }

  // ── Answer key: boxes wide enough for their answers ─────────────────────────
  for (const key of $$('.key')) {
    const cells = Array.from(key.children);
    const columns = getComputedStyle(key).gridTemplateColumns.split(' ').length;
    const saved = key.style.gridTemplateColumns;
    key.style.gridTemplateColumns = 'repeat(' + columns + ', max-content)';
    const natural = Math.ceil(Math.max(...cells.map(widthOf)));
    key.style.gridTemplateColumns = saved;
    if (natural > widthOf(cells[0]) + 0.5) {
      const room = inner(key.closest('.key-sheet') || key.parentElement);
      const perRow = Math.max(1, Math.min(cells.length, Math.floor(room / natural)));
      key.style.gridTemplateColumns = 'repeat(' + perRow + ', ' + natural + 'px)';
      stats.keysResized++;
      if (natural > room) add('error', 'answer-overflow', key, 'An answer is wider than the page.');
    }
  }

  // ── Everything else: anything still wider than the box it is in ──────────────
  const BOXES = HOLDER + ', .options, .question, .solution, .key-block, .mdisp';
  for (const box of $$(BOXES)) {
    if (box.scrollWidth > box.clientWidth + 1 && box.clientWidth > 0) {
      add('error', 'text-overflow', box, 'Content runs past the edge of its column.');
    }
  }
  return { issues, stats };
})()`;

// ── The finished PDF ───────────────────────────────────────────────────────

type Matrix = [number, number, number, number, number, number];
/** a then b, for points as rows, as PDF matrices work. */
const then = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface PdfExpectation {
  /** Questions that must be on the pages as "(n)"; 0 for an answer key on its own. */
  questions: number;
  /** Raster figures the paper places; every one must be painted. */
  figures: number;
  /** The watermark printed across each page, if any: it is slanted text, not paper content. */
  watermark?: string;
}

/**
 * Looks at the finished PDF: text or figures outside the frame, blank pages,
 * and questions or figures that never made it onto a page.
 */
export async function checkPdf(bytes: Uint8Array, expect: PdfExpectation): Promise<{ issues: LayoutIssue[]; pages: number }> {
  const issues: LayoutIssue[] = [];
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const seen = new Set<number>();
  let figures = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [, , width, height] = page.view;
    // The frame is the @page margin box; the page number sits just below it.
    const frame: Box = {
      left: PAGE_MARGIN_MM.side * MM_TO_PT,
      right: width - PAGE_MARGIN_MM.side * MM_TO_PT,
      top: height - PAGE_MARGIN_MM.top * MM_TO_PT,
      bottom: PAGE_MARGIN_MM.bottom * MM_TO_PT,
    };
    const slack = 1.5;
    const outside = (box: Box) =>
      box.left < frame.left - slack || box.right > frame.right + slack || box.top > frame.top + slack || box.bottom < frame.bottom - slack;

    const content = await page.getTextContent();
    let marks = 0;
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      // The watermark is slanted (paper text never is) and may reach past the frame; it is neither content nor a stray.
      if (expect.watermark && Math.abs(item.transform[1]) > 1e-3 && expect.watermark.includes(item.str.trim())) continue;
      const box: Box = {
        left: item.transform[4],
        right: item.transform[4] + item.width,
        bottom: item.transform[5],
        top: item.transform[5] + item.height,
      };
      for (const m of item.str.matchAll(/^\((\d{1,3})\)$/g)) seen.add(Number(m[1]));
      // The page number is the one thing printed below the frame.
      if (box.top <= frame.bottom && /^\d+$/.test(item.str.trim())) continue;
      if (outside(box)) {
        issues.push({
          severity: "error",
          kind: "text-outside-page",
          where: `Page ${n}`,
          detail: `"${item.str.trim().slice(0, 40)}" is outside the page frame.`,
        });
        continue;
      }
      marks++;
    }

    const { fnArray, argsArray } = await page.getOperatorList();
    const { OPS } = pdfjs;
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const saved: Matrix[] = [];
    let painted = 0;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (fn === OPS.save) saved.push(ctm);
      else if (fn === OPS.restore) ctm = saved.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = then(argsArray[i] as Matrix, ctm);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        painted++;
        const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
        const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
        const box: Box = { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
        if (outside(box)) {
          issues.push({ severity: "error", kind: "figure-outside-page", where: `Page ${n}`, detail: "A figure is outside the page frame." });
        }
      }
    }
    figures += painted;
    if (marks === 0 && painted === 0) {
      issues.push({ severity: "error", kind: "blank-page", where: `Page ${n}`, detail: "The page is empty." });
    }
  }

  const missing = Array.from({ length: expect.questions }, (_, i) => i + 1).filter((q) => !seen.has(q));
  if (missing.length) {
    const list = missing.slice(0, 10).join(", ") + (missing.length > 10 ? "…" : "");
    issues.push({ severity: "error", kind: "question-missing", where: "Paper", detail: `Question ${list} is not on any page.` });
  }
  if (figures < expect.figures) {
    issues.push({
      severity: "error",
      kind: "figure-missing",
      where: "Paper",
      detail: `${expect.figures - figures} of ${expect.figures} figures are not on any page.`,
    });
  }
  const pages = doc.numPages;
  await task.destroy();
  return { issues, pages };
}
