// The watermark a teacher can print across every page of an exam paper
// (never on a Smart PDF). The app keeps a copy of the cleaning rule in
// pcmb-paper/src/shared/watermark.ts; change both together.

/** Longest watermark, in characters. */
export const MAX_WATERMARK = 40;

/** One line of at most MAX_WATERMARK characters: whitespace and control characters become single spaces. */
export function cleanWatermark(value: string): string {
  const oneLine = value.replace(/[\p{Cc}\s]+/gu, " ").trim();
  return Array.from(oneLine).slice(0, MAX_WATERMARK).join("");
}

/**
 * Light grey with no transparency. A black-and-white printer turns it into a
 * faint screen of dots under the paper's near-black text, so the questions
 * stay sharp and the watermark still shows; a colour printer prints it grey.
 */
export const WATERMARK_COLOR = "#d6d6d6";

/**
 * The grey for a watermark `opacityPct` % dark (0 is white). Still an opaque
 * grey, never a transparency, for the reason above; 16 gives WATERMARK_COLOR.
 */
export function watermarkColor(opacityPct: number): string {
  const level = Math.round(255 * (1 - opacityPct / 100));
  const hex = Math.min(255, Math.max(0, level)).toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

const WATERMARK_ANGLE_DEG = -35;
/** The widest the text may run along its slanted line, in mm (the printed area is 198 × 279 mm). */
const WATERMARK_LENGTH_MM = 165;
/** Average glyph width of bold Noto Sans, with room to spare for wide letters, in em. */
const GLYPH_EM = 0.68;
const MM_TO_PT = 72 / 25.4;

/** Big for a short name, smaller for a long one so it still fits across the page. */
export function watermarkFontPt(text: string): number {
  const pt = (WATERMARK_LENGTH_MM / (Array.from(text).length * GLYPH_EM)) * MM_TO_PT;
  return Math.round(Math.min(64, Math.max(18, pt)));
}

/** The CSS for the element watermarkHtml makes, in the grey for `color` (the default grey when none is given). */
export const watermarkCss = (color: string = WATERMARK_COLOR) => `
  /* Repeats on every page like the frame, and sits behind the text: it has no background, so nothing it is under is covered. */
  .watermark { position: fixed; inset: 0; z-index: -1; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; user-select: none; }
  .watermark span { transform: rotate(${WATERMARK_ANGLE_DEG}deg); white-space: nowrap; font-weight: 700; letter-spacing: 0.04em; color: ${color}; }`;

export const WATERMARK_CSS = watermarkCss();

export function watermarkHtml(text: string, escape: (text: string) => string): string {
  return `<div class="watermark" aria-hidden="true"><span style="font-size: ${watermarkFontPt(text)}pt">${escape(text)}</span></div>`;
}
