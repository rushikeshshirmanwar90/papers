// Smart PDF layout rules: one question per 16:9 slide, the question and its
// options at the top and the rest left blank for the teacher to write on.
//
// The same file is papers/src/lib/smartSlides/layout.ts (the server prints
// slides by it) and pcmb-paper/src/shared/smart-slide-layout.ts (the app's
// layout preview follows it). Change both together; the app's test checks
// they match.
// Plain TypeScript with no imports, so both projects can run it as is.

export type SlideTheme = "dark" | "green" | "white";
export type SlideFontSize = "small" | "medium" | "large";
export type McqLayoutSetting = "auto" | "horizontal" | "grid" | "vertical";
export type McqLayout = Exclude<McqLayoutSetting, "auto">;

/** What a teacher can change; remembered per teacher on their phone. */
export interface SmartSlideSettings {
  theme: SlideTheme;
  /** How much of the slide's height the question may use, in %; the rest is for writing. */
  questionAreaPct: number;
  fontSize: SlideFontSize;
  mcqLayout: McqLayoutSetting;
  showInstitute: boolean;
}

export const DEFAULT_SMART_SLIDE_SETTINGS: SmartSlideSettings = {
  theme: "dark",
  questionAreaPct: 30,
  fontSize: "medium",
  mcqLayout: "auto",
  showInstitute: true,
};

export const QUESTION_AREA_RANGE = { min: 25, max: 50, step: 5 };

export const THEME_CHOICES: { value: SlideTheme; label: string }[] = [
  { value: "dark", label: "Dark Board" },
  { value: "green", label: "Green Board" },
  { value: "white", label: "Whiteboard" },
];
export const FONT_SIZE_CHOICES: { value: SlideFontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
export const MCQ_LAYOUT_CHOICES: { value: McqLayoutSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "horizontal", label: "Horizontal" },
  { value: "grid", label: "2×2" },
  { value: "vertical", label: "Vertical" },
];

export interface SlideColors {
  background: string;
  text: string;
  muted: string;
  /** The option letters. */
  accent: string;
}

export const SLIDE_THEMES: Record<SlideTheme, SlideColors> = {
  dark: { background: "#1F2326", text: "#F3F1EA", muted: "#A9ADA8", accent: "#F2C66D" },
  green: { background: "#24392C", text: "#F1F4EA", muted: "#AEBBA9", accent: "#F4DF86" },
  white: { background: "#FFFFFF", text: "#1C1C1E", muted: "#6E6E73", accent: "#B4532A" },
};

const pick = <T extends string>(value: unknown, allowed: readonly { value: T }[], fallback: T): T =>
  allowed.some((choice) => choice.value === value) ? (value as T) : fallback;

/** Any stored or posted value as valid settings; whatever is missing or wrong takes its default. */
export function normalizeSlideSettings(raw: unknown): SmartSlideSettings {
  const d = DEFAULT_SMART_SLIDE_SETTINGS;
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const area = typeof r.questionAreaPct === "number" && Number.isFinite(r.questionAreaPct) ? r.questionAreaPct : d.questionAreaPct;
  const { min, max, step } = QUESTION_AREA_RANGE;
  return {
    theme: pick(r.theme, THEME_CHOICES, d.theme),
    questionAreaPct: Math.min(max, Math.max(min, Math.round(area / step) * step)),
    fontSize: pick(r.fontSize, FONT_SIZE_CHOICES, d.fontSize),
    mcqLayout: pick(r.mcqLayout, MCQ_LAYOUT_CHOICES, d.mcqLayout),
    showInstitute: typeof r.showInstitute === "boolean" ? r.showInstitute : d.showInstitute,
  };
}

/** Where a teacher's settings are kept on the phone: one key per signed-in account. */
export const slidePrefsKey = (userId: string) => `smartPdfLayout.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;

// ─── Geometry ──────────────────────────────────────────────────────────────
// In CSS px on a 960 × 540 slide (10 × 5.625 in). The preview scales them.

export const SLIDE = {
  width: 960,
  height: 540,
  padX: 36,
  padTop: 14,
  /** The line with the question number, title and institute. */
  headerFont: 11,
  headerHeight: 16,
  headerGap: 6,
  padBottom: 8,
  /** Gap between the stem and the options, and between options. */
  gap: 8,
  /** Room for "(A)" before an option, in ems. */
  markEm: 1.9,
  lineHeight: 1.35,
  /** Width of the figure column beside the text, as a share of the content width. */
  figureShare: 0.36,
  figureGap: 16,
  optionFigureHeight: 64,
};

/** Body text size, in px on the 960-wide slide (≈ the same size in pt on a 13.3 in slide). */
export const FONT_PX: Record<SlideFontSize, number> = { small: 15, medium: 18, large: 22 };
/** The smallest the print pass may shrink text to so a question still fits. */
export const MIN_FONT_PX = 13;

export interface SlideGeometry {
  /** Height of the question area, from the top of the slide. */
  regionHeight: number;
  /** Where the question's content starts, and how much height it has. */
  contentTop: number;
  contentHeight: number;
  contentWidth: number;
  fontPx: number;
  lineHeightPx: number;
}

export function slideGeometry(settings: SmartSlideSettings): SlideGeometry {
  const regionHeight = Math.round((SLIDE.height * settings.questionAreaPct) / 100);
  const contentTop = SLIDE.padTop + SLIDE.headerHeight + SLIDE.headerGap;
  const fontPx = FONT_PX[settings.fontSize];
  return {
    regionHeight,
    contentTop,
    contentHeight: regionHeight - contentTop - SLIDE.padBottom,
    contentWidth: SLIDE.width - 2 * SLIDE.padX,
    fontPx,
    lineHeightPx: fontPx * SLIDE.lineHeight,
  };
}

// ─── Estimating text ───────────────────────────────────────────────────────

/** What the slide needs of a question. */
export interface SlideQuestion {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  answerType: string;
  diagramUrls: string[];
  optionDiagramUrls: { A: string[]; B: string[]; C: string[]; D: string[] };
}

export const OPTION_KEYS = ["A", "B", "C", "D"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/** Average glyph width as a share of the font size; on the generous side so estimates err towards more room. */
const CHAR_EM = 0.53;
/** Maths that stands taller than a line of text. */
const TALL_MATH = /\\(?:d?frac|tfrac|sum|int|oint|prod|sqrt|lim|binom|over|begin|matrix|underset|overset|stackrel)\b|\^\{[^}]{3,}\}/;

/** Roughly how many characters wide a text prints: LaTeX markup counts for little. */
export function visibleLength(text: string): number {
  return text
    .replace(/\\(?:left|right|displaystyle|mathrm|mathbf|text|operatorname)\b/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[\\$(){}[\]^_]/g, "").length;
}

/** Estimated height of a text set `widthPx` wide. */
export function textHeight(text: string, fontPx: number, widthPx: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const perLine = Math.max(8, Math.floor(widthPx / (fontPx * CHAR_EM)));
  const lineHeight = fontPx * SLIDE.lineHeight;
  let height = 0;
  for (const paragraph of trimmed.split(/\n+/)) {
    const lines = Math.max(1, Math.ceil(visibleLength(paragraph) / perLine));
    const tall = TALL_MATH.test(paragraph) ? 1.45 : 1;
    const display = /\\\[|\$\$/.test(paragraph) ? lineHeight * 0.6 : 0;
    height += lines * lineHeight * tall + display;
  }
  return height;
}

export const optionText = (q: SlideQuestion, key: OptionKey) => q[`option${key}` as const] ?? "";

/** The options a question shows: none for a numerical one. */
export function optionsOf(q: SlideQuestion): OptionKey[] {
  if (q.answerType === "Numerical") return [];
  return OPTION_KEYS.filter((key) => optionText(q, key).trim() || q.optionDiagramUrls[key].length);
}

const COLUMNS: Record<McqLayout, number> = { horizontal: 4, grid: 2, vertical: 1 };

/** How the options sit: "auto" puts them in one row, a 2 × 2 grid or one per line, whichever keeps each on one line. */
export function chooseMcqLayout(q: SlideQuestion, setting: McqLayoutSetting, fontPx: number, widthPx: number): McqLayout | null {
  const keys = optionsOf(q);
  if (!keys.length) return null;
  if (setting !== "auto") return setting;
  const hasFigure = keys.some((key) => q.optionDiagramUrls[key].length);
  const widest = Math.max(...keys.map((key) => visibleLength(optionText(q, key)))) * fontPx * CHAR_EM;
  const mark = SLIDE.markEm * fontPx;
  const cell = (columns: number) => (widthPx - (columns - 1) * SLIDE.gap * 2) / columns - mark;
  if (!hasFigure && widest <= cell(4)) return "horizontal";
  if (widest <= cell(2)) return "grid";
  return "vertical";
}

/** Estimated height of the options block (or of some of its options). */
export function optionsHeight(q: SlideQuestion, layout: McqLayout, fontPx: number, widthPx: number, keys: OptionKey[] = optionsOf(q)): number {
  if (!keys.length) return 0;
  const columns = COLUMNS[layout];
  const cellWidth = (widthPx - (columns - 1) * SLIDE.gap * 2) / columns - SLIDE.markEm * fontPx;
  const heights = keys.map((key) => {
    const text = textHeight(optionText(q, key), fontPx, cellWidth) || 0;
    const figure = q.optionDiagramUrls[key].length ? SLIDE.optionFigureHeight + 4 : 0;
    return Math.max(fontPx * SLIDE.lineHeight, text + figure);
  });
  let total = 0;
  for (let row = 0; row < keys.length; row += columns) total += Math.max(...heights.slice(row, row + columns));
  return total + (Math.ceil(keys.length / columns) - 1) * SLIDE.gap;
}

// ─── Splitting long questions ──────────────────────────────────────────────

/**
 * The stem cut into pieces that may go on different slides: paragraphs, then
 * sentences, then runs of words. Never inside maths ($…$, \(…\), \[…\]).
 */
export function stemPieces(text: string): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.trim().split(/\n+/)) {
    if (paragraph.trim()) pieces.push(...breakOutsideMath(paragraph, /[.?!;:]\s+/g));
  }
  return pieces;
}

/** Ranges of `text` that are maths. */
function mathRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\$[^$\n]*?\$/g;
  for (const m of text.matchAll(re)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return ranges;
}

function breakOutsideMath(text: string, boundary: RegExp): string[] {
  const maths = mathRanges(text);
  const inMath = (at: number) => maths.some(([start, end]) => at > start && at < end);
  const out: string[] = [];
  let from = 0;
  for (const m of text.matchAll(boundary)) {
    const at = (m.index ?? 0) + m[0].length;
    if (inMath(m.index ?? 0)) continue;
    out.push(text.slice(from, at).trim());
    from = at;
  }
  out.push(text.slice(from).trim());
  return out.filter(Boolean);
}

/** A piece too tall for a whole slide, as runs of words that each fit. */
function byWords(piece: string, fontPx: number, widthPx: number, maxHeight: number): string[] {
  const words = breakOutsideMath(piece, /\s+/g);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && textHeight(next, fontPx, widthPx) > maxHeight) {
      out.push(current);
      current = word;
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}

/** One slide of a question. */
export interface SlidePart {
  /** The part of the stem on this slide. */
  stem: string;
  /** The question's figures sit beside the text of its first slide. */
  figures: boolean;
  /** Whether this slide shows options: all of them on the question's last slide, or a row or more of them when they can't all fit together. */
  options: boolean;
  /** The options on this slide, in order. */
  optionKeys: OptionKey[];
  /** Carries on from the slide before. */
  continued: boolean;
}

export interface QuestionSlidePlan {
  parts: SlidePart[];
  mcqLayout: McqLayout | null;
  fontPx: number;
  /** The text column's width: narrower when a figure sits beside it. */
  textWidth: number;
  /** Width of the figure column, or 0. */
  figureWidth: number;
  /** The estimate says even one piece can't fit at this size; printing will shrink it, or report it. */
  tight: boolean;
}

/**
 * A question's slides. Usually one; a question too long for its area runs on
 * to continuation slides, its options always on the last one.
 */
export function planQuestionSlides(q: SlideQuestion, settings: SmartSlideSettings): QuestionSlidePlan {
  const g = slideGeometry(settings);
  const hasFigure = q.diagramUrls.length > 0;
  const figureWidth = hasFigure ? Math.round(g.contentWidth * SLIDE.figureShare) : 0;
  const textWidth = hasFigure ? g.contentWidth - figureWidth - SLIDE.figureGap : g.contentWidth;
  const fontPx = g.fontPx;
  const room = g.contentHeight;
  const mcqLayout = chooseMcqLayout(q, settings.mcqLayout, fontPx, textWidth);
  let tight = false;

  const pieces = stemPieces(q.questionText).flatMap((piece) =>
    textHeight(piece, fontPx, textWidth) > room ? byWords(piece, fontPx, textWidth, room) : [piece]
  );

  const parts: SlidePart[] = [];
  const push = (stem: string, optionKeys: OptionKey[]) =>
    parts.push({ stem, figures: parts.length === 0, options: optionKeys.length > 0, optionKeys, continued: parts.length > 0 });
  let current: string[] = [];
  const height = (list: string[]) => textHeight(list.join(" "), fontPx, textWidth);
  for (const piece of pieces) {
    const next = [...current, piece];
    if (current.length && height(next) > room) {
      push(current.join(" "), []);
      current = [piece];
    } else current = next;
    if (height(current) > room) tight = true;
  }

  // The options stay together when they fit; otherwise they are cut between
  // rows, a slide's worth at a time, each option kept whole.
  const keys = optionsOf(q);
  const groups: OptionKey[][] = [];
  if (mcqLayout && keys.length) {
    const columns = COLUMNS[mcqLayout];
    const rowsOf = (list: OptionKey[]) => optionsHeight(q, mcqLayout, fontPx, textWidth, list);
    let group: OptionKey[] = [];
    for (let row = 0; row < keys.length; row += columns) {
      const rowKeys = keys.slice(row, row + columns);
      if (rowsOf(rowKeys) > room) tight = true;
      if (group.length && rowsOf([...group, ...rowKeys]) > room) {
        groups.push(group);
        group = rowKeys;
      } else group = [...group, ...rowKeys];
    }
    groups.push(group);
  }

  // The first options join the last piece of the stem if they fit with it; the rest follow on slides of their own.
  const lastStem = current.join(" ");
  if (!groups.length) push(lastStem, []);
  else {
    const first = groups[0];
    const fitsWithStem =
      !lastStem || height(current) + SLIDE.gap + optionsHeight(q, mcqLayout!, fontPx, textWidth, first) <= room;
    if (fitsWithStem) push(lastStem, first);
    else {
      push(lastStem, []);
      push("", first);
    }
    for (const group of groups.slice(1)) push("", group);
  }
  return { parts, mcqLayout, fontPx, textWidth, figureWidth, tight };
}
