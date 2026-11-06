import { escapeHtml, fontFaces, fontStack, richText, type EmbeddedFigures, type PaperQuestion, type QuestionPaper } from "../questionPaper/html";
import {
  DEFAULT_SMART_SLIDE_SETTINGS,
  MIN_FONT_PX,
  optionsOf,
  optionText,
  SLIDE,
  SLIDE_THEMES,
  slideGeometry,
  type OptionKey,
  type SmartSlideSettings,
} from "./layout";

// The Smart PDF as one printable HTML page: a 16:9 page per slide, the
// question at the top, the rest of the slide left blank for writing. No
// answers, solutions or watermark.
//
// Nothing here guesses how tall a question prints. Each question goes into the
// page whole, in the teacher's preferred question area; FIT_SLIDES_SCRIPT then
// runs in that same page in Chrome (same CSS, fonts, maths and figures as the
// PDF), measures every question and sizes its slide:
//
//   short   fits the preferred area: the area as set, blank space below
//   medium  needs more: the area grows to fit, still leaving writing space
//   full    needs most of the slide: it gets the whole slide, and a blank
//           writing slide follows it
//
// A slide always holds one complete question with all its options: a question
// is never cut across slides. One too long for a whole slide at the chosen
// size is made to fit: its text is set smaller (first down to 80% of the
// chosen size, then, as a last resort, to a small but legible size, which is
// reported as a warning), and if the options are still too tall they are set
// in a more compact layout. Only a question that still doesn't fit all that
// (thousands of characters) is reported, and then no PDF is printed at all.

/** The area may grow to this share of the slide and still count as leaving room to write; beyond it the question gets a whole slide and a blank slide after. */
export const MEDIUM_MAX_SHARE = 0.65;
/** Text is only made smaller (to avoid continuation slides) down to this share of the chosen size, and never under MIN_FONT_PX. */
export const MIN_FONT_SHARE = 0.8;
/** The smallest size a question's text is ever set at, as a last resort to keep the question whole (px on the 960-wide slide). */
export const LAST_RESORT_FONT_PX = 11;
/** A question's figure is shown up to this tall (its own size if smaller), and is only shrunk below it to fit a full slide. */
export const FIGURE_PX = 220;
/** A figure shrunk below this is reported as small. */
export const FIGURE_MIN_PX = 80;

/** The smallest size a question's text may be set at, for a chosen size. */
export const minFontPx = (fontPx: number) => Math.max(MIN_FONT_PX, Math.ceil(fontPx * MIN_FONT_SHARE));

/** Figures as <img> tags, or a note for one that couldn't be loaded. */
function figures(urls: string[], embedded: EmbeddedFigures, className: string, maxHeight: number): string {
  return urls
    .map((url) => {
      const data = embedded.get(url);
      return data
        ? `<img class="${className}" src="${data}" alt="" style="max-height:${Math.floor(maxHeight)}px">`
        : '<p class="missing">Figure could not be loaded.</p>';
    })
    .join("");
}

function optionsHtml(q: PaperQuestion, layout: string, keys: OptionKey[], embedded: EmbeddedFigures): string {
  return `<div class="options ${layout}" data-count="${keys.length}">${keys
    .map(
      (key) =>
        `<div class="option" data-key="${key}"><span class="mark">(${key})</span>${richText(optionText(q, key))}${figures(
          q.optionDiagramUrls[key],
          embedded,
          "opt-fig",
          SLIDE.optionFigureHeight
        )}</div>`
    )
    .join("")}</div>`;
}

/** Everything the measuring pass needs to know about the slide, in px. */
function fitConfig(settings: SmartSlideSettings) {
  const g = slideGeometry(settings);
  const full = SLIDE.height - g.contentTop - SLIDE.padBottom;
  return {
    slideWidth: SLIDE.width,
    slideHeight: SLIDE.height,
    contentTop: g.contentTop,
    padBottom: SLIDE.padBottom,
    gap: SLIDE.gap,
    font: g.fontPx,
    minFont: minFontPx(g.fontPx),
    floorFont: Math.min(LAST_RESORT_FONT_PX, minFontPx(g.fontPx)),
    pref: g.contentHeight,
    full,
    medMax: Math.max(g.contentHeight, Math.floor(SLIDE.height * MEDIUM_MAX_SHARE) - g.contentTop - SLIDE.padBottom),
    figPx: FIGURE_PX,
    figMin: FIGURE_MIN_PX,
  };
}

export function smartSlidesHtml(paper: QuestionPaper, embedded: EmbeddedFigures): string {
  const settings = paper.slides ?? DEFAULT_SMART_SLIDE_SETTINGS;
  const g = slideGeometry(settings);
  const colors = SLIDE_THEMES[settings.theme];
  const institute = settings.showInstitute ? paper.institute.trim() : "";
  const title = paper.title.trim();
  const contentWidth = g.contentWidth;
  const figureWidth = Math.round(contentWidth * SLIDE.figureShare);
  // "auto" is decided by measuring; before that the options start one per line.
  const startLayout = settings.mcqLayout === "auto" ? "vertical" : settings.mcqLayout;

  const slides = paper.questions.map((q, i) => {
    const number = i + 1;
    const keys = optionsOf(q);
    const figureColumn = q.diagramUrls.length
      ? `<div class="fig" style="width:${figureWidth}px">${figures(q.diagramUrls, embedded, "q-fig", FIGURE_PX)}</div>`
      : "";
    return `<section class="slide q" data-q="${number}" data-layout="${settings.mcqLayout}" data-options="${keys.length}">
  <div class="qa" style="height:${g.regionHeight}px">
    <div class="head"><span class="qno">Q${number}</span>${title ? `<span class="title">${escapeHtml(title)}</span>` : ""}${
      institute ? `<span class="inst">${escapeHtml(institute)}</span>` : ""
    }</div>
    <div class="body" style="font-size:${g.fontPx}px;height:${g.contentHeight}px">
      <div class="text">${q.questionText.trim() ? `<div class="stem">${richText(q.questionText)}</div>` : ""}${
        keys.length ? optionsHtml(q, startLayout, keys, embedded) : ""
      }</div>${figureColumn}
    </div>
  </div>
</section>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.title)}</title>
<style>
  ${fontFaces(settings.fontFamily)}
  @page { size: ${SLIDE.width}px ${SLIDE.height}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${colors.background}; }
  body { font-family: ${fontStack(settings.fontFamily)}; color: ${colors.text}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  math { font-family: "Noto Sans Math", math; font-size: 1.05em; color: inherit; }
  /* Each slide is exactly one page and lays out on its own (contain), so
     measuring one slide never reflows the others. */
  .slide { position: relative; width: ${SLIDE.width}px; height: ${SLIDE.height}px; overflow: hidden; contain: strict; background: ${colors.background}; break-after: page; }
  .slide:last-child { break-after: auto; }
  /* The question area; everything below it stays blank for writing. */
  .qa { padding: ${SLIDE.padTop}px ${SLIDE.padX}px ${SLIDE.padBottom}px; overflow: hidden; }
  .head { display: flex; align-items: baseline; gap: 10px; height: ${SLIDE.headerHeight}px; margin-bottom: ${SLIDE.headerGap}px; font-size: ${SLIDE.headerFont}px; line-height: ${SLIDE.headerHeight}px; color: ${colors.muted}; white-space: nowrap; }
  .qno { font-weight: 700; color: ${colors.accent}; }
  .title { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .inst { margin-left: auto; font-weight: 700; overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 50%; }
  .body { display: flex; gap: ${SLIDE.figureGap}px; overflow: hidden; line-height: ${SLIDE.lineHeight}; }
  .text { flex: 1; min-width: 0; align-self: flex-start; }
  .stem { overflow-wrap: anywhere; }
  .msplit math { display: inline math; }
  .mdisp { text-align: center; }
  .mseg { display: inline-block; vertical-align: middle; }
  .options { display: grid; gap: ${SLIDE.gap}px ${SLIDE.gap * 2}px; margin-top: ${SLIDE.gap}px; }
  .stem + .options { margin-top: ${SLIDE.gap}px; }
  .text > .options:first-child { margin-top: 0; }
  .options.horizontal { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .options.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .options.vertical { grid-template-columns: minmax(0, 1fr); }
  /* Measuring only: each option at its natural one-line width. */
  .options.probe { display: block; }
  .options.probe .option { display: inline-block; white-space: nowrap; vertical-align: top; }
  .option { position: relative; padding-left: ${SLIDE.markEm}em; min-width: 0; overflow-wrap: anywhere; }
  .mark { position: absolute; left: 0; top: 0; font-weight: 700; color: ${colors.accent}; }
  .fig { flex: none; align-self: flex-start; display: flex; flex-direction: column; align-items: center; gap: ${SLIDE.gap}px; }
  /* Figures are dark line art: a white card keeps them visible on a board. */
  img.q-fig, img.opt-fig { display: block; max-width: 100%; width: auto; height: auto; object-fit: contain; background: #fff; border-radius: 6px; padding: 4px; }
  img.opt-fig { margin-top: 4px; }
  .missing { margin: 0; font-size: 12px; font-style: italic; color: ${colors.muted}; }
</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>`;
}

/** How one question was laid out. */
export interface SlidePlanEntry {
  q: number;
  kind: "short" | "medium" | "full";
  /** A blank writing slide follows (the question took the whole slide). */
  blankAfter: boolean;
  fontPx: number;
  /** "horizontal", "grid", "vertical", or "" with no options. */
  optionLayout: string;
  /** Height of the question area on its last slide, in px. */
  areaPx: number;
}

/** What Chrome's measuring pass returns. */
export interface SlideFitResult {
  issues: { severity: "error" | "warning"; kind: string; where: string; detail: string }[];
  stats: {
    slides: number;
    questions: number;
    short: number;
    medium: number;
    full: number;
    blank: number;
    shrunk: number;
    equationsScaled: number;
    /** Waiting for fonts and figures, then laying out, in ms. */
    readyMs: number;
    layoutMs: number;
  };
  plan: SlidePlanEntry[];
}

/** The measuring pass for a page smartSlidesHtml made with these settings. */
export function fitSlidesScript(settings: SmartSlideSettings = DEFAULT_SMART_SLIDE_SETTINGS): string {
  return FIT_SLIDES_SCRIPT.replace("__CONFIG__", JSON.stringify(fitConfig(settings)));
}

/**
 * Runs in the page through page.evaluate (the page itself runs no scripts).
 * Waits for fonts and figures, sizes each question's slide from its measured
 * size (see the top of this file), checks every slide, and returns the plan.
 */
const FIT_SLIDES_SCRIPT = String.raw`(async () => {
  const C = __CONFIG__;
  const t0 = performance.now();
  const issues = [];
  const plan = [];
  const stats = { slides: 0, questions: 0, short: 0, medium: 0, full: 0, blank: 0, shrunk: 0, equationsScaled: 0, readyMs: 0, layoutMs: 0 };
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const num = (value) => parseFloat(value) || 0;
  const rect = (el) => el.getBoundingClientRect();

  // Measure only once the real fonts and figures are in: the first layout
  // asks for the fonts the text uses; then wait for them and every image.
  void document.body.offsetHeight;
  await document.fonts.ready;
  await Promise.all($$('img').map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
  void document.body.offsetHeight;
  await document.fonts.ready;
  const tReady = performance.now();

  const partsOf = (s) => ({
    qa: s.querySelector('.qa'),
    body: s.querySelector('.body'),
    text: s.querySelector('.text'),
    stem: s.querySelector('.stem'),
    options: s.querySelector('.options'),
    fig: s.querySelector('.fig'),
    qno: s.querySelector('.qno'),
  });
  const say = (q, severity, kind, detail) => issues.push({ severity, kind, where: 'Question ' + q, detail });

  // How far an element's drawing reaches (a formula can draw past its own box).
  const naturalWidth = (el) => {
    const box = rect(el);
    let right = box.right;
    for (const part of el.querySelectorAll('*')) {
      const r = rect(part);
      if (r.width || r.height) right = Math.max(right, r.right);
    }
    return Math.max(box.width, right - box.left);
  };
  const innerWidth = (el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight);
  };
  const mathUnits = (root) => $$('.mseg', root).concat($$('math', root).filter((m) => !m.closest('.mseg')));

  // A formula with no place to break that is wider than its column is scaled
  // down, that formula only. Returns the smallest scale used.
  const fitWide = (s) => {
    let worst = 1;
    for (const unit of mathUnits(s)) {
      unit.style.zoom = '';
      const holder = unit.closest('.stem, .option');
      if (!holder) continue;
      const room = innerWidth(holder);
      let scale = 1;
      for (let pass = 0; pass < 4; pass++) {
        const width = naturalWidth(unit);
        if (width <= room + 0.5) break;
        scale *= room / width;
        unit.style.zoom = String(scale);
      }
      worst = Math.min(worst, scale);
    }
    return worst;
  };

  // "auto": one row of four, a 2 × 2 grid or one per line, whichever keeps
  // every option on one line, from each option's measured one-line width.
  const chooseLayout = (s) => {
    const { options, text } = partsOf(s);
    if (!options || s.getAttribute('data-layout') !== 'auto') return;
    options.classList.remove('horizontal', 'grid', 'vertical');
    options.classList.add('probe');
    const widest = Math.max(...$$('.option', options).map(naturalWidth));
    options.classList.remove('probe');
    const width = text.clientWidth;
    const cell = (columns) => (width - (columns - 1) * C.gap * 2) / columns;
    options.classList.add(widest <= cell(4) ? 'horizontal' : widest <= cell(2) ? 'grid' : 'vertical');
  };

  const setFont = (s, px) => {
    partsOf(s).body.style.fontSize = px + 'px';
    s.setAttribute('data-font', String(px));
  };

  // The height the question needs: its text, or its figures at their own
  // size (up to C.figPx), whichever is taller. Figures alone never push a
  // question on to another slide; they are shrunk into a full slide instead.
  const needed = (s) => {
    const p = partsOf(s);
    p.body.style.height = 'auto';
    p.qa.style.height = 'auto';
    if (p.fig) for (const img of $$('img', p.fig)) img.style.maxHeight = C.figPx + 'px';
    const worst = fitWide(s);
    const textH = rect(p.text).height;
    const figH = p.fig ? Math.min(rect(p.fig).height, C.full) : 0;
    return { h: Math.max(textH, figH), textH, worst };
  };

  // Gives the question area its height; figures taller than it are shrunk.
  const setArea = (s, bodyH, q) => {
    const p = partsOf(s);
    bodyH = Math.min(C.full, Math.ceil(bodyH));
    p.body.style.height = bodyH + 'px';
    p.qa.style.height = C.contentTop + bodyH + C.padBottom + 'px';
    if (p.fig) {
      const imgs = $$('img', p.fig);
      const over = rect(p.fig).height - bodyH;
      if (over > 0.5 && imgs.length) {
        const heights = imgs.map((img) => rect(img).height);
        const total = heights.reduce((a, b) => a + b, 0);
        const scale = Math.max(0, (total - over - 1) / total);
        imgs.forEach((img, i) => (img.style.maxHeight = Math.floor(heights[i] * scale) + 'px'));
        if (heights.some((h) => h * scale < C.figMin)) say(q, 'warning', 'figure-small', 'Question ' + q + "'s figures were made smaller to fit the slide.");
      }
    }
    return bodyH;
  };

  // Short, medium or full, from the measured height.
  const finish = (s, h, q) => {
    let kind;
    let bodyH;
    if (h <= C.pref + 0.5) {
      kind = 'short';
      bodyH = C.pref;
    } else if (h <= C.medMax) {
      kind = 'medium';
      bodyH = h + 2;
    } else {
      kind = 'full';
      bodyH = C.full;
    }
    s.setAttribute('data-kind', kind);
    return { kind, bodyH: setArea(s, bodyH, q) };
  };

  const error = (q, detail) => {
    say(q, 'error', 'slide-overflow', detail);
    return null;
  };

  const OPTION_LAYOUTS = ['vertical', 'grid', 'horizontal'];
  const layoutOf = (s) => {
    const options = partsOf(s).options;
    return options ? OPTION_LAYOUTS.find((c) => options.classList.contains(c)) || '' : '';
  };

  const questions = $$('.slide.q');
  stats.questions = questions.length;
  for (const s of questions) {
    const q = s.getAttribute('data-q');
    // The whole question must fit one slide. Its text is set smaller a pixel
    // at a time, from the chosen size to the least that is legible; only if
    // the options are still too tall are they set in a more compact layout.
    let font = C.font;
    let m;
    for (;;) {
      setFont(s, font);
      chooseLayout(s);
      m = needed(s);
      if (m.h <= C.full + 0.5 || font <= C.floorFont) break;
      font--;
    }
    const options = partsOf(s).options;
    if (m.h > C.full + 0.5 && options) {
      // Vertical is the tallest layout, then 2 × 2, then one row of four.
      for (const layout of OPTION_LAYOUTS.slice(OPTION_LAYOUTS.indexOf(layoutOf(s)) + 1)) {
        options.classList.remove(...OPTION_LAYOUTS);
        options.classList.add(layout);
        m = needed(s);
        if (m.h <= C.full + 0.5) break;
      }
    }
    if (m.h > C.full + 0.5) {
      error(q, 'it is too long to fit on one slide even at the smallest legible text size, and a question is never split across slides.');
      continue;
    }
    if (font < C.font) stats.shrunk++;
    if (font < C.minFont) say(q, 'warning', 'text-small', 'Question ' + q + "'s text was set at " + font + ' px, smaller than usual, to keep the question on one slide.');
    s.setAttribute('data-font', String(font));
    const lastM = needed(s);
    if (lastM.worst < 0.5) say(q, 'error', 'equation-unreadable', 'An equation in question ' + q + ' has no place to break and would print too small to read. Split it into steps.');
    else if (lastM.worst < 1) stats.equationsScaled++;
    const { kind, bodyH } = finish(s, lastM.h, q);
    // A question that took the whole slide is followed by a blank slide to solve it on.
    const blankAfter = kind === 'full';
    if (blankAfter) {
      const blank = document.createElement('section');
      blank.className = 'slide blank';
      blank.setAttribute('data-blank-for', q);
      s.after(blank);
      stats.blank++;
    }
    stats[kind]++;
    plan.push({
      q: Number(q),
      kind,
      blankAfter,
      fontPx: font,
      optionLayout: layoutOf(s),
      areaPx: C.contentTop + bodyH + C.padBottom,
    });
  }

  // ── Check every slide as it will print ──────────────────────────────────
  const all = $$('.slide');
  stats.slides = all.length;
  const optionSlides = new Map();
  all.forEach((slide, index) => {
    if (!slide.classList.contains('q')) {
      if (slide.textContent.trim() || slide.querySelector('img')) issues.push({ severity: 'error', kind: 'blank-not-blank', where: 'Slide ' + (index + 1), detail: 'A writing slide has content on it.' });
      return;
    }
    const q = slide.getAttribute('data-q');
    const sr = rect(slide);
    const p = partsOf(slide);
    const br = rect(p.body);
    const inside = (r, box) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    const boxes = [p.text, p.fig].filter(Boolean).concat($$('.option, img, .mseg, .stem .t', slide));
    for (const el of boxes) {
      const r = rect(el);
      if (!r.width && !r.height) continue;
      if (!inside(r, br) || !inside(r, sr)) {
        say(q, 'error', 'slide-overflow', 'Question ' + q + ' does not fit inside its slide.');
        break;
      }
    }
    const opts = $$('.option', slide);
    if (opts.length) {
      const list = optionSlides.get(q) || [];
      list.push({ index, count: opts.length });
      optionSlides.set(q, list);
    }
  });
  for (const s of questions) {
    const q = s.getAttribute('data-q');
    const expected = Number(s.getAttribute('data-options'));
    const list = optionSlides.get(q) || [];
    if (expected && (list.length !== 1 || list[0].count !== expected)) say(q, 'error', 'options-split', "Question " + q + "'s options are not all on one slide.");
  }
  stats.readyMs = Math.round(tReady - t0);
  stats.layoutMs = Math.round(performance.now() - tReady);
  return { issues, stats, plan };
})()`;
