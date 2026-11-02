import { readFileSync } from "fs";
import path from "path";
import katex from "katex";
import { splitLatex } from "./latex";
import { PAGE_MARGIN_MM, TEXT_INSET_MM } from "./layoutFit";
import { splitMath } from "./mathBreak";
import type { SmartSlideSettings } from "../smartSlides/layout";

// The question paper as one printable HTML page: an A4 sheet in a frame, the
// institute's name over the paper's details, then the questions in two columns
// (a question paper, its answer key and its solutions each start a new page).
// The pcmb-paper app posts the picked questions and gets the PDF back.

export interface PaperQuestion {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  answerType: string;
  correctAnswer: string;
  explanation: string;
  chapter: string;
  /** Where the question was asked, e.g. "JEE MAIN 2020"; printed after the question. */
  source: string;
  diagramUrls: string[];
  optionDiagramUrls: { A: string[]; B: string[]; C: string[]; D: string[] };
  explanationDiagramUrls: string[];
}

export interface QuestionPaper {
  title: string;
  /** The institute's name (and phone), from the signed-in account's tuition. */
  institute: string;
  standard: string;
  subject: string;
  questions: PaperQuestion[];
  marksPerQuestion: number;
  /** "1" in "Paper Set : 1". */
  paperSet: string;
  /** yyyy-mm-dd, or "" when not set. */
  date: string;
  /** The exam's length, or null when not set. */
  durationMinutes: number | null;
  /** Prints the questions with their options. False for an answer key on its own. */
  questionPaper: boolean;
  /** Adds an answer key on a page of its own after the questions. */
  answerKey: boolean;
  /** Adds each question's worked solution after that. */
  solutions: boolean;
  /** Refuse to make the PDF (rather than just report) when its layout has errors. */
  strictLayout: boolean;
  /** "smart": one question per 16:9 slide with room to write (lib/smartSlides). Missing means the exam paper. */
  format?: "exam" | "smart";
  /** The Smart PDF's layout, when format is "smart". */
  slides?: SmartSlideSettings;
}

/** Figures as data URIs, by URL; null for one that couldn't be loaded. */
export type EmbeddedFigures = ReadonlyMap<string, string | null>;

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
type OptionKey = (typeof OPTION_KEYS)[number];
const optionText = (question: PaperQuestion, key: OptionKey) => question[`option${key}` as const];

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const renderMath = (tex: string, displayMode: boolean) =>
  katex.renderToString(tex, { displayMode, output: "mathml", throwOnError: false, strict: "ignore" });

/**
 * One formula as MathML, which Chrome draws with the embedded math font. A
 * long one is cut into pieces at valid places (mathBreak.ts) with a line-break
 * opportunity between them, so it wraps instead of running out of its column;
 * layoutFit.ts then scales the rare piece that is still too wide.
 */
function mathHtml(tex: string, display: boolean): string {
  const pieces = splitMath(tex);
  if (display) {
    return `<div class="mdisp">${pieces.map((piece) => `<span class="mseg">${renderMath(piece, true)}</span>`).join("<wbr>")}</div>`;
  }
  return pieces.length === 1 ? renderMath(pieces[0], false) : `<span class="msplit">${pieces.map((piece) => renderMath(piece, false)).join("<wbr>")}</span>`;
}

/**
 * Text as HTML: escaped, line breaks kept, and the maths (\( \) and \[ \])
 * as MathML.
 */
export function richText(text: string | undefined): string {
  return splitLatex(text ?? "")
    .map((piece) => {
      if (piece.kind === "text") return escapeHtml(piece.value).replace(/\n/g, "<br>");
      try {
        return mathHtml(piece.value, piece.display);
      } catch {
        return escapeHtml(piece.value);
      }
    })
    .join("");
}

/** One word (or formula) of a text, as richTokens returns it. */
export interface RichToken {
  html: string;
  /** What separates it from the next token: "" (last), " ", or one or more line breaks. */
  after: "" | " " | `\n${string}`;
  /** It ends a sentence or clause, a good place to continue on another slide. */
  sentenceEnd: boolean;
}

/**
 * The same text as richText, as words and whole formulas, so a slide can be
 * cut between any two of them. Joined back (a space, or <br> per line break,
 * between them) it prints just as richText does.
 */
export function richTokens(text: string | undefined): RichToken[] {
  const tokens: { html: string; raw: string; after: string }[] = [];
  const glue = (html: string, raw: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.after === "") {
      last.html += html;
      last.raw += raw;
    } else tokens.push({ html, raw, after: "" });
  };
  for (const piece of splitLatex(text ?? "")) {
    if (piece.kind === "math") {
      let html: string;
      try {
        html = mathHtml(piece.value, piece.display);
      } catch {
        html = escapeHtml(piece.value);
      }
      glue(html, "$");
      continue;
    }
    for (const part of piece.value.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        const last = tokens[tokens.length - 1];
        if (last) last.after = part.includes("\n") ? "\n".repeat((part.match(/\n/g) ?? []).length) : " ";
      } else glue(escapeHtml(part), part);
    }
  }
  return tokens.map((token, i) => ({
    html: token.html,
    after: i === tokens.length - 1 ? "" : ((token.after || " ") as RichToken["after"]),
    sentenceEnd: /[.?!;:]["')\]]*$/.test(token.raw),
  }));
}

function figureTags(urls: string[], embedded: EmbeddedFigures): string {
  return urls
    .map((url) => {
      const data = embedded.get(url);
      return data ? `<img class="figure" src="${data}" alt="">` : '<p class="missing">Figure could not be loaded.</p>';
    })
    .join("");
}

const isNumerical = (question: PaperQuestion) => question.answerType === "Numerical";

/** The option letters a stored answer names: "B", or "A, C" for more than one. */
function correctKeys(question: PaperQuestion): OptionKey[] {
  if (isNumerical(question)) return [];
  const letters = question.correctAnswer.toUpperCase().split(/[^A-D]+/);
  return OPTION_KEYS.filter((key) => letters.includes(key));
}

/** Roughly how wide an option prints: its text without the LaTeX markup around it. */
const visibleLength = (text: string) => text.replace(/\\[a-zA-Z]+|[\\$(){}[\]^_]/g, "").length;

function questionHtml(question: PaperQuestion, number: number, embedded: EmbeddedFigures, showAnswer: boolean): string {
  const options = isNumerical(question)
    ? []
    : OPTION_KEYS.filter((key) => optionText(question, key) || question.optionDiagramUrls[key].length);
  // Short options without figures sit two to a row, like a printed paper; the rest one to a row.
  const short = options.every(
    (key) => !question.optionDiagramUrls[key].length && visibleLength(optionText(question, key)) <= 22
  );
  const right = showAnswer ? correctKeys(question) : [];
  const optionList = options.length
    ? `<div class="options${short ? " short" : ""}">${options
        .map(
          (key) =>
            `<div class="option${right.includes(key) ? " right" : ""}"><span class="mark">(${key})</span>${richText(
              optionText(question, key)
            )}${figureTags(question.optionDiagramUrls[key], embedded)}</div>`
        )
        .join("")}</div>`
    : "";
  const source = question.source.trim() ? `<div class="source">[${escapeHtml(question.source.trim())}]</div>` : "";
  return `<div class="question"><span class="number">(${number})</span><div class="stem">${richText(
    question.questionText
  )}</div>${source}${figureTags(question.diagramUrls, embedded)}${optionList}${
    showAnswer ? solutionHtml(question, embedded) : ""
  }</div>`;
}

/** The answer as printed: the stored one, or a dash when the question bank has none. */
const answerOf = (question: PaperQuestion) => (question.correctAnswer.trim() ? richText(question.correctAnswer.trim()) : "–");

function solutionHtml(question: PaperQuestion, embedded: EmbeddedFigures): string {
  const answer = answerOf(question);
  const body = question.explanation.trim()
    ? richText(question.explanation)
    : "A worked solution isn't in the question bank for this question.";
  return `<div class="solution"><div class="solution-head">Solution:(Correct Answer:${answer})</div><div class="solution-body">${body}</div>${figureTags(
    question.explanationDiagramUrls,
    embedded
  )}</div>`;
}

/** Every figure the paper shows, each once. */
export function figureUrlsOf(paper: QuestionPaper): string[] {
  const showQuestions = paper.questionPaper || paper.solutions;
  const urls = paper.questions.flatMap((q) => [
    ...(showQuestions ? [...q.diagramUrls, ...OPTION_KEYS.flatMap((key) => q.optionDiagramUrls[key])] : []),
    ...(paper.solutions ? q.explanationDiagramUrls : []),
  ]);
  return [...new Set(urls)];
}

// Fonts go inside the page: the server has no fonts of its own, and this way
// a paper looks the same printed on Vercel as on a laptop.
const FONT_FILES = path.join(process.cwd(), "node_modules", "@fontsource");
const TEXT_RANGES = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext":
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  greek: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
};
const TEXT_STYLES = [
  { weight: 400, style: "normal", file: "400-normal" },
  { weight: 400, style: "italic", file: "400-italic" },
  { weight: 700, style: "normal", file: "700-normal" },
];

const fontData = (file: string) => `url(data:font/woff2;base64,${readFileSync(path.join(FONT_FILES, file)).toString("base64")})`;

let fontCss: string | null = null;
export function fontFaces(): string {
  fontCss ??= [
    ...TEXT_STYLES.flatMap(({ weight, style, file }) =>
      Object.entries(TEXT_RANGES).map(
        ([subset, range]) =>
          `@font-face { font-family: "Noto Sans"; font-weight: ${weight}; font-style: ${style}; ` +
          `src: ${fontData(`noto-sans/files/noto-sans-${subset}-${file}.woff2`)} format("woff2"); unicode-range: ${range}; }`
      )
    ),
    // The whole math font: its MATH table draws fractions, roots and stretchy brackets.
    `@font-face { font-family: "Noto Sans Math"; src: ${fontData(
      "noto-sans-math/files/noto-sans-math-latin-400-normal.woff2"
    )} format("woff2"); }`,
  ].join("\n");
  return fontCss;
}

// ─── Sheet header ──────────────────────────────────────────────────────────

/** "2026-08-30" as "30-08-2026"; anything else as it came. */
function dateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : date;
}

/** 90 minutes as "1H:30M". */
function durationLabel(minutes: number | null): string {
  return minutes === null ? "" : `${Math.floor(minutes / 60)}H:${String(minutes % 60).padStart(2, "0")}M`;
}

/** "11th" as "11", as the printed header has it. */
const standardLabel = (standard: string) => standard.replace(/^(\d+)(st|nd|rd|th)$/i, "$1");

/** What a paper is called when the request gives no title. */
export const DEFAULT_PAPER_TITLE = "Question paper";

/** The centred heading: the paper's title (the app fills it from the chapter and the teacher may edit it); with no title, the chapters. */
function headingOf(paper: QuestionPaper): string {
  const title = paper.title.trim();
  if (title && title !== DEFAULT_PAPER_TITLE) return title;
  const chapters = [...new Set(paper.questions.map((q) => q.chapter.trim()).filter(Boolean))];
  const joined = chapters.join(" · ");
  return joined && joined.length <= 80 ? joined : title;
}

function field(label: string, value: string): string {
  return `<div class="field"><b>${label}</b><span>: ${value ? escapeHtml(value) : "–"}</span></div>`;
}

/** What a page of the paper is, for the line under the heading. */
type Part = { kind: "questions" | "key" | "solutions"; label: string };

function sheetHeader(paper: QuestionPaper, part: Part): string {
  const totalMarks = paper.questions.length * paper.marksPerQuestion;
  const institute = paper.institute.trim() || "Question paper";
  return `<header class="sheet-head">
    <h1 class="institute${institute.length > 42 ? " long" : ""}">${escapeHtml(institute)}</h1>
    <div class="details">
      <div class="side">${field("Subject", paper.subject)}${field("Standard", standardLabel(paper.standard))}${field("Total Mark", String(totalMarks))}</div>
      <div class="centre"><div class="heading">${escapeHtml(headingOf(paper))}</div>${
        part.label ? `<div class="part-label">(${part.label})</div>` : ""
      }</div>
      <div class="side right">${field("Paper Set", paper.paperSet)}${field("Date", dateLabel(paper.date))}${field("Time", durationLabel(paper.durationMinutes))}</div>
    </div>
  </header>`;
}

// ─── Sections ──────────────────────────────────────────────────────────────

interface Section {
  kind: "MCQ" | "Numerical";
  /** "Physics - Section A", without its kind. */
  title: string;
  /** Position of its first question in the paper, from 0. */
  start: number;
  questions: PaperQuestion[];
}

/**
 * The questions, in the order given, cut into runs of one kind: a run of
 * multiple-choice questions is Section A, the numerical ones after it Section B.
 */
function sectionsOf(paper: QuestionPaper): Section[] {
  const sections: Section[] = [];
  paper.questions.forEach((question, index) => {
    const kind = isNumerical(question) ? "Numerical" : "MCQ";
    const last = sections[sections.length - 1];
    if (last?.kind === kind) return void last.questions.push(question);
    const letter = String.fromCharCode(65 + sections.length);
    sections.push({
      kind,
      title: `${paper.subject ? `${paper.subject} - ` : ""}Section ${letter}`,
      start: index,
      questions: [question],
    });
  });
  return sections;
}

const sectionHeading = (section: Section) =>
  `<div class="section-title"><span>${escapeHtml(section.title)} <small>(${section.kind})</small></span></div>`;

function answerTable(section: Section): string {
  const cells = section.questions.map((q, i) => ({ number: section.start + i + 1, answer: answerOf(q) }));
  // Ten to a row when the answers are letters; fewer when they are values.
  const wide = section.questions.some((q) => q.correctAnswer.trim().length > 4);
  const perRow = wide ? 5 : 10;
  return `<div class="key-block">${sectionHeading(section)}<div class="key${wide ? " wide" : ""}" style="grid-template-columns: repeat(${Math.min(perRow, cells.length)}, ${wide ? 32 : 16}mm)">${cells
    .map((c) => `<div>${c.number} - ${c.answer}</div>`)
    .join("")}</div></div>`;
}

// ─── The page ──────────────────────────────────────────────────────────────

export function questionPaperHtml(paper: QuestionPaper, embedded: EmbeddedFigures): string {
  const sections = sectionsOf(paper);

  const columns = (showAnswer: boolean) =>
    `<div class="columns">${sections
      .map(
        (section) =>
          sectionHeading(section) +
          section.questions.map((q, i) => questionHtml(q, section.start + i + 1, embedded, showAnswer)).join("")
      )
      .join("")}</div>`;

  const parts: string[] = [];
  const add = (part: Part, body: string) =>
    parts.push(`<section class="part" data-part="${part.kind}">${sheetHeader(paper, part)}${body}</section>`);
  if (paper.questionPaper) add({ kind: "questions", label: "" }, columns(false));
  if (paper.answerKey) add({ kind: "key", label: "Answer Key" }, `<div class="key-sheet">${sections.map(answerTable).join("")}</div>`);
  if (paper.solutions) add({ kind: "solutions", label: "Solutions" }, columns(true));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.title)}</title>
<style>
  ${fontFaces()}
  @page {
    size: A4;
    margin: ${PAGE_MARGIN_MM.top}mm ${PAGE_MARGIN_MM.side}mm ${PAGE_MARGIN_MM.bottom}mm;
    @bottom-center { content: counter(page); font: 9pt "Noto Sans", sans-serif; color: #1a1a1a; vertical-align: top; padding-top: 3mm; }
  }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans", "Noto Sans Math", sans-serif; font-size: 9.8pt; line-height: 1.38; color: #1a1a1a; margin: 0; }
  math { font-family: "Noto Sans Math", math; font-size: 1.05em; }

  /* The frame repeats on every page; the text sits a little inside it. */
  .frame { position: fixed; inset: 0; border: 1px solid #1a1a1a; }
  .part { break-before: page; padding: 0 ${TEXT_INSET_MM}mm; }
  .part:first-of-type { break-before: auto; }

  .sheet-head { margin: 0 -${TEXT_INSET_MM}mm 4mm; padding: 4mm ${TEXT_INSET_MM * 2}mm 2.5mm; border-bottom: 1px solid #1a1a1a; }
  .institute { margin: 0 0 6mm; text-align: center; font-size: 23pt; line-height: 1.2; font-weight: 700; }
  .institute.long { font-size: 17pt; }
  .details { display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: start; gap: 4mm; font-size: 10.5pt; }
  .field { display: grid; grid-template-columns: 24mm 1fr; margin: 0 0 1.6mm; }
  .side.right .field { grid-template-columns: 19mm 1fr; margin-left: auto; max-width: 52mm; }
  .field b { font-weight: 700; color: #26283a; }
  .centre { text-align: center; padding-top: 2mm; }
  .heading { font-size: 15pt; font-weight: 700; line-height: 1.25; color: #26283a; overflow-wrap: anywhere; }
  .part-label { margin-top: 3mm; font-size: 10.5pt; font-weight: 700; }

  .columns { column-count: 2; column-gap: 9mm; column-rule: 1px solid #1a1a1a; column-fill: auto; padding: 3mm 0; box-decoration-break: clone; }
  .section-title { display: flex; align-items: center; gap: 1.5mm; margin: 0 0 4mm; break-after: avoid; break-inside: avoid; }
  .section-title::before, .section-title::after { content: ""; flex: 1; border-bottom: 1.5px dotted #1a1a1a; min-width: 2mm; }
  .section-title span { padding: 1.2mm 3mm; border: 1px solid #1a1a1a; outline: 1px solid #1a1a1a; outline-offset: 1px; font-size: 12.5pt; font-weight: 700; color: #26283a; text-align: center; }
  .section-title small { font-size: 8.5pt; font-weight: 400; color: #1a1a1a; }

  .question { position: relative; padding-left: 8mm; margin: 0 0 3.2mm; }
  .stem { orphans: 2; widows: 2; }
  /* Whatever a box holds wraps inside it: nothing may push it wider than its column. */
  .question, .options, .option, .solution, .stem, .source, .solution-head, .solution-body, .field span, .heading { min-width: 0; max-width: 100%; }
  .source, .solution-head { overflow-wrap: anywhere; }
  .section-title span { max-width: 100%; overflow-wrap: anywhere; }
  .field span { overflow-wrap: anywhere; }
  /* Long formulas: pieces that wrap like words; a display formula's pieces fill lines, centred. */
  .msplit math { display: inline math; }
  /* Only once a formula really wraps (layoutFit.ts tags it): room between its lines for tall fractions. */
  .msplit.wrapped math { padding: 0.18em 0; }
  .mdisp { text-align: center; }
  .mseg { display: inline-block; vertical-align: middle; max-width: none; }
  .source { break-before: avoid; }
  .options, .option, img.figure, .solution-head, .mseg { break-inside: avoid; }
  .solution-head { break-after: avoid; }
  .number { position: absolute; left: 0.5mm; top: 0; }
  .stem { overflow-wrap: anywhere; }
  .source { color: #3d5a99; }
  .options { display: grid; grid-template-columns: 1fr; gap: 1.4mm 4mm; margin-top: 1.6mm; }
  .options.short { grid-template-columns: 1fr 1fr; }
  .option { position: relative; padding-left: 6.5mm; overflow-wrap: anywhere; }
  .options > .option { min-width: 0; }
  .option .mark { position: absolute; left: 0; top: 0; }
  .option.right { color: #1b7f3a; font-weight: 700; }
  img.figure { display: block; width: auto; height: auto; max-width: 100%; max-height: 62mm; margin: 2mm 0; object-fit: contain; }
  .missing { margin: 2pt 0; color: #888; font-size: 9pt; font-style: italic; }

  .solution { margin-top: 2.4mm; }
  .solution-head { font-weight: 700; padding-left: 2mm; }
  .solution-body { padding: 0 0 0 2mm; overflow-wrap: anywhere; }

  .key-sheet { display: flex; flex-direction: column; align-items: center; gap: 6mm; padding-top: 2mm; }
  .key-block { display: flex; flex-direction: column; align-items: center; gap: 4mm; break-inside: avoid; }
  .key-block .section-title { margin: 0; }
  .key-block .section-title::before, .key-block .section-title::after { display: none; }
  /* A grid of boxes sharing their borders; a short last row keeps the cell width. */
  .key { display: grid; width: max-content; font-size: 8.5pt; border-left: 1px solid #1a1a1a; border-top: 1px solid #1a1a1a; }
  .key div { border-right: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 1mm; text-align: center; overflow-wrap: anywhere; }
  .key.wide { font-size: 9.5pt; }
</style>
</head>
<body>
  <div class="frame"></div>
  ${parts.join("\n")}
</body>
</html>`;
}
