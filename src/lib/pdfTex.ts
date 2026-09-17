// Reading-order event stream for TeX-typeset exam PDFs, with every formula
// rebuilt as LaTeX by texMath.ts. Same PdfEvent contract as pdfStructured.ts
// (column detection, inline diagram images), so coachingPaperParser.ts can
// consume either. Use this one when the PDF's fonts are Computer Modern —
// pdfStructured.ts's heuristics for Word-style "stacked rows" don't apply to
// TeX output, whose fraction bars are real drawn rules.

import {
  applyPoint,
  detectColumnBoundary,
  encodePngFromImageData,
  multiply,
  type Matrix,
  type PdfEvent,
  type TextItem,
} from "./pdfStructured";
import { classifyFont, layoutTexColumn, type Glyph, type Rule } from "./texMath";
import { loadPdfjs } from "./pdfjsNode";

interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  buffer: Buffer;
}

export interface TexExtraction {
  events: PdfEvent[];
  /** True when Computer Modern maths fonts were found — i.e. this pipeline applies. */
  isTex: boolean;
}

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;
const ARG_COUNT: Record<number, number> = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 };

/**
 * Walks one constructPath payload and returns the horizontal rules in it:
 * thin, short, level strokes/fills — fraction bars and root vinculums.
 */
function rulesFromPath(segments: ArrayLike<number>[], ctm: Matrix): Rule[] {
  const out: Rule[] = [];
  for (const seg of segments) {
    const arr = Array.from(seg);
    const pts: [number, number][] = [];
    let j = 0;
    while (j < arr.length) {
      const code = arr[j++];
      const n = ARG_COUNT[code];
      if (n === undefined) break;
      if (code === DRAW.moveTo || code === DRAW.lineTo) pts.push(applyPoint(ctm, arr[j], arr[j + 1]));
      else if (code === DRAW.curveTo) pts.push(applyPoint(ctm, arr[j + 4], arr[j + 5]));
      j += n;
    }
    if (pts.length < 2) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const y1 = Math.min(...ys);
    const y2 = Math.max(...ys);
    const w = x2 - x1;
    const h = y2 - y1;
    if (h <= 1.5 && w >= 1.5 && w <= 260) out.push({ x1, x2, y: (y1 + y2) / 2 });
  }
  return out;
}

// A function name the PDF glued onto prose punctuation — "Thus,cos" — has
// to be its own token so it can join the maths that follows.
const GLUED_FUNCTION_RE = /^(.*[,.;:!?()])(sin|cos|tan|cot|sec|csc|cosec|log|ln)$/i;

// Approximate Computer Modern advance widths (em) for placing the characters
// of a merged run. pdf.js reports only the run's total width, and a fraction
// bar or vinculum may cover just part of a run ("3" in "3+1"), so each
// character needs its own position.
function cmWidth(ch: string): number {
  if (/[0-9]/.test(ch)) return 0.5;
  if (/[+\-−=±×·<>]/.test(ch)) return 0.778;
  if (/[()[\]|/]/.test(ch)) return 0.389;
  if (/[.,;:]/.test(ch)) return 0.278;
  if (/[A-Z]/.test(ch)) return 0.72;
  if (/[mw]/.test(ch)) return 0.83;
  if (/[il]/.test(ch)) return 0.3;
  if (/[a-z]/.test(ch)) return 0.5;
  return 0.6;
}

/**
 * Splits a text run into positioned tokens: prose into words, maths into
 * single characters (letter sequences such as "sin" stay whole).
 */
function splitRun(str: string, x: number, width: number, y: number, size: number, font: Glyph["font"]): Glyph[] {
  const chars = Array.from(str);
  const out: Glyph[] = [];
  const tokens: [number, number][] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    if (font === "text") while (j < chars.length && !/\s/.test(chars[j])) j++;
    else if (/[A-Za-z]/.test(chars[i])) while (j < chars.length && /[A-Za-z]/.test(chars[j])) j++;
    tokens.push([i, j]);
    i = j;
  }
  // Position by estimated widths, scaled so the run still spans its real width.
  const est = chars.map((c) => (/\s/.test(c) ? 0.33 : font === "text" ? 0.5 : cmWidth(c)));
  const total = est.reduce((a, b) => a + b, 0) || 1;
  const scale = width / total;
  const starts: number[] = [0];
  for (let k = 0; k < chars.length; k++) starts.push(starts[k] + est[k] * scale);
  const pushTok = (from: number, to: number) =>
    out.push({ str: chars.slice(from, to).join(""), x: x + starts[from], endX: x + starts[to], y, size, font });
  for (const [from, to] of tokens) {
    const word = chars.slice(from, to).join("");
    const glued = font === "text" ? word.match(GLUED_FUNCTION_RE) : null;
    if (glued) {
      const cut = from + Array.from(glued[1]).length;
      pushTok(from, cut);
      pushTok(cut, to);
    } else pushTok(from, to);
  }
  return out;
}

type Frag = { text: string; x: number; endX: number };

function splitAtGaps(fragments: Frag[], gap = 40): Frag[][] {
  const groups: Frag[][] = [];
  let prevEnd = -Infinity;
  for (const f of fragments) {
    if (f.x - prevEnd > gap || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(f);
    prevEnd = f.endX;
  }
  return groups;
}

export async function extractTexPdf(buffer: Buffer): Promise<TexExtraction> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true })
    .promise;
  const events: PdfEvent[] = [];
  let sawTexFont = false;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });

    // Operator list first: it loads the fonts into commonObjs (needed for the
    // real font names) and carries the drawn rules and placed images.
    const opList = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    const rules: Rule[] = [];
    const images: ImagePlacement[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
      else if (fn === OPS.constructPath) rules.push(...rulesFromPath(args[1] as ArrayLike<number>[], ctm));
      else if (fn === OPS.paintImageXObject) {
        try {
          const objId = args[0];
          const img = await new Promise<{ width: number; height: number; data: Uint8ClampedArray | Uint8Array }>(
            (resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("image object never resolved")), 500);
              page.objs.get(objId, (value: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }) => {
                clearTimeout(timer);
                resolve(value);
              });
            }
          );
          const corners = [applyPoint(ctm, 0, 0), applyPoint(ctm, 1, 0), applyPoint(ctm, 0, 1), applyPoint(ctm, 1, 1)];
          const png = encodePngFromImageData(img);
          if (png) {
            images.push({
              x: Math.min(...corners.map((c) => c[0])),
              y: Math.max(...corners.map((c) => c[1])),
              width: img.width,
              height: img.height,
              buffer: png,
            });
          }
        } catch {
          // Undecodable image: skip it rather than fail the upload.
        }
      }
    }

    const content = await page.getTextContent();
    const fontClass = new Map<string, Glyph["font"]>();
    const glyphs: Glyph[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      let cls = fontClass.get(it.fontName);
      if (cls === undefined) {
        const name = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as { name?: string }).name : "";
        cls = classifyFont(name);
        fontClass.set(it.fontName, cls);
        if (cls !== "text") sawTexFont = true;
      }
      const x = it.transform[4];
      const y = it.transform[5];
      const size = Math.hypot(it.transform[0], it.transform[1]) || it.height;
      const width = typeof it.width === "number" ? it.width : 0;
      // Prose is split into words too, so a function name ("sin") that the
      // PDF glued onto the preceding prose can join the maths run after it.
      glyphs.push(...splitRun(it.str, x, width, y, size, cls));
    }

    const columnItems: TextItem[] = glyphs.map((g) => ({ str: g.str, x: g.x, y: g.y, endX: g.endX }));
    const boundary = detectColumnBoundary(columnItems, viewport.width);
    const split = <T extends { x: number }>(arr: T[]) =>
      boundary === null ? [arr, [] as T[]] : [arr.filter((i) => i.x < boundary), arr.filter((i) => i.x >= boundary)];
    const [leftG, rightG] = split(glyphs);
    const [leftR, rightR] = split(rules.map((r) => ({ ...r, x: r.x1 })));
    const [leftI, rightI] = split(images);

    // Running headers occupy a deep band at the top (institute name, subject,
    // paper set, date); footers just carry a page number. Lines here are only
    // *eligible* for the parser's repeated-boilerplate filter, so a content
    // line that happens to sit high on the page is never dropped on its own.
    const HEADER_BAND = 130;
    const FOOTER_BAND = 60;
    const emitColumn = (g: Glyph[], r: Rule[], imgs: ImagePlacement[]) => {
      const entries: { y: number; event: PdfEvent }[] = [];
      for (const l of layoutTexColumn(g, r)) {
        const edge = l.y < FOOTER_BAND || l.y > viewport.height - HEADER_BAND;
        // A running header is several fields spread across the page at one
        // y ("Subject : …    Paper Set : 1"); split at the wide gaps so each
        // field repeats verbatim page after page and is recognised as such.
        if (!edge) {
          entries.push({ y: l.y, event: { kind: "text", value: l.text, fragments: l.fragments, y: l.y, edge } });
          continue;
        }
        for (const frags of splitAtGaps(l.fragments)) {
          const value = frags.map((f) => f.text).join(" ").trim();
          if (value) entries.push({ y: l.y, event: { kind: "text", value, fragments: frags, y: l.y, edge } });
        }
      }
      entries.push(
        ...imgs.map((im) => ({
          y: im.y,
          event: { kind: "image" as const, buffer: im.buffer, width: im.width, height: im.height },
        }))
      );
      entries.sort((a, b) => b.y - a.y);
      for (const e of entries) events.push(e.event);
    };
    emitColumn(leftG, leftR, leftI);
    emitColumn(rightG, rightR, rightI);
    events.push({ kind: "pagebreak" });
  }

  return { events, isTex: sawTexFont };
}
