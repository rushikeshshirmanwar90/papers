// Smart PDF layout rules: one question per 16:9 slide, the question and its
// options at the top and the rest left blank for the teacher to write on.
//
// The same file is papers/src/lib/smartSlides/layout.ts (the server's slide
// geometry and settings) and pcmb-paper/src/shared/smart-slide-layout.ts (the
// app's settings and sample preview). Change both together; the app's test
// checks they match.
//
// The server never sizes a slide from the estimates below: it measures each
// question in Chrome and grows its area, or gives it a whole slide, as needed
// (papers/src/lib/smartSlides/html.ts). The estimates only draw the app's
// sample slide.
// Plain TypeScript with no imports, so both projects can run it as is.

export type SlideTheme = "dark" | "green" | "white";
export type SlideFontSize = "small" | "medium" | "large";
export type McqLayoutSetting = "auto" | "horizontal" | "grid" | "vertical";
export type McqLayout = Exclude<McqLayoutSetting, "auto">;

/** What a teacher can change; remembered per teacher on their phone. */
export interface SmartSlideSettings {
  theme: SlideTheme;
  /** How much of the slide's height the question area takes, in %, the rest left for writing. A preference: a question that needs more gets more. */
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
/** The server never sets a question's text smaller than this. */
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

// ─── Questions, and the app's sample preview ──────────────────────────────

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

/** Average glyph width as a share of the font size (the sample preview's estimate). */
const CHAR_EM = 0.53;
/** Roughly how many characters wide a text prints: LaTeX markup counts for little. */
export function visibleLength(text: string): number {
  return text
    .replace(/\\(?:left|right|displaystyle|mathrm|mathbf|text|operatorname)\b/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[\\$(){}[\]^_]/g, "").length;
}

export const optionText = (q: SlideQuestion, key: OptionKey) => q[`option${key}` as const] ?? "";

/** The options a question shows: none for a numerical one. */
export function optionsOf(q: SlideQuestion): OptionKey[] {
  if (q.answerType === "Numerical") return [];
  return OPTION_KEYS.filter((key) => optionText(q, key).trim() || q.optionDiagramUrls[key].length);
}

/** The sample preview's options layout: "auto" puts them in one row, a 2 × 2 grid or one per line, whichever keeps each on one line. */
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
