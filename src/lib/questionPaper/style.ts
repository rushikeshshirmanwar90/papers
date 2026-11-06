// How a teacher can style an exam paper: font, text size, one or two columns,
// spacing, the institute's logo in the header, and how strong the watermark
// is. Every value comes from a fixed list; anything else (or nothing) takes
// its default, so a request can never ask for a font file or a size that is
// not listed here.
//
// The same file is papers/src/lib/questionPaper/style.ts (the server's paper)
// and pcmb-paper/src/shared/paper-style.ts (the app's Exam PDF settings).
// Change both together; the app's test checks they match.
// Plain TypeScript with no imports, so both projects can run it as is.

/** The fonts a paper can be set in: the server bundles these, and no others. */
export type PaperFont = "noto-sans" | "noto-serif";
export const FONT_CHOICES: { value: PaperFont; label: string }[] = [
  { value: "noto-sans", label: "Sans" },
  { value: "noto-serif", label: "Serif" },
];

export type PaperFontSize = "small" | "medium" | "large";
export const FONT_SIZE_CHOICES: { value: PaperFontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
/** Body text size in pt; "medium" is what papers have always used. */
export const FONT_SIZE_PT: Record<PaperFontSize, number> = { small: 9, medium: 9.8, large: 10.8 };

export type PaperColumns = 1 | 2;
export const COLUMN_CHOICES: { value: PaperColumns; label: string }[] = [
  { value: 2, label: "Two columns" },
  { value: 1, label: "One column" },
];

/** How much room the questions take: Compact fits more on a page, Spacious leaves room to work. */
export type PaperSpacing = "compact" | "standard" | "spacious";
export const SPACING_CHOICES: { value: PaperSpacing; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "spacious", label: "Spacious" },
];
/** Gap under each question in mm, and the text's line height. "standard" is the existing layout. */
export const SPACING_VALUES: Record<PaperSpacing, { questionGapMm: number; lineHeight: number }> = {
  compact: { questionGapMm: 2, lineHeight: 1.28 },
  standard: { questionGapMm: 3.2, lineHeight: 1.38 },
  spacious: { questionGapMm: 5, lineHeight: 1.5 },
};

/** How dark the watermark prints, in %: 0 would be white. The default is the grey papers have always used. */
export const WATERMARK_OPACITY = { min: 5, max: 40, default: 16 };
export const WATERMARK_OPACITY_CHOICES = [10, 16, 25, 40];

export interface PaperStyle {
  fontFamily: PaperFont;
  fontSize: PaperFontSize;
  columns: PaperColumns;
  spacing: PaperSpacing;
  /** Print the institute's logo in the header (needs one uploaded). */
  logo: boolean;
  watermarkOpacity: number;
}

export const DEFAULT_PAPER_STYLE: PaperStyle = {
  fontFamily: "noto-sans",
  fontSize: "medium",
  columns: 2,
  spacing: "standard",
  logo: false,
  watermarkOpacity: WATERMARK_OPACITY.default,
};

const pick = <T extends string | number>(value: unknown, allowed: readonly { value: T }[], fallback: T): T =>
  allowed.some((choice) => choice.value === value) ? (value as T) : fallback;

/** Any stored or posted value as a valid style; whatever is missing or wrong takes its default. */
export function normalizePaperStyle(raw: unknown): PaperStyle {
  const d = DEFAULT_PAPER_STYLE;
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const { min, max } = WATERMARK_OPACITY;
  const opacity = typeof r.watermarkOpacity === "number" && Number.isFinite(r.watermarkOpacity) ? Math.round(r.watermarkOpacity) : d.watermarkOpacity;
  return {
    fontFamily: pick(r.fontFamily, FONT_CHOICES, d.fontFamily),
    fontSize: pick(r.fontSize, FONT_SIZE_CHOICES, d.fontSize),
    columns: pick(r.columns, COLUMN_CHOICES, d.columns),
    spacing: pick(r.spacing, SPACING_CHOICES, d.spacing),
    logo: typeof r.logo === "boolean" ? r.logo : d.logo,
    watermarkOpacity: Math.min(max, Math.max(min, opacity)),
  };
}

/** Where a teacher's Exam PDF style is kept on the phone: one key per signed-in account. */
export const paperStylePrefsKey = (userId: string) => `examPdfStyle.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
