import { readFileSync } from "fs";
import path from "path";
import katex from "katex";
import { splitLatex } from "./latex";

// The question paper as one printable HTML page, laid out like the pcmb-paper
// app's own print (src/lib/question-paper-pdf.ts there, before PDFs moved here).

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
  diagramUrls: string[];
  optionDiagramUrls: { A: string[]; B: string[]; C: string[]; D: string[] };
  explanationDiagramUrls: string[];
}

export interface QuestionPaper {
  title: string;
  standard: string;
  subject: string;
  questions: PaperQuestion[];
  marksPerQuestion: number;
  /** Adds an answer key on a page of its own after the questions. */
  answerKey: boolean;
  /** Adds each question's worked solution after that. */
  solutions: boolean;
}

/** Figures as data URIs, by URL; null for one that couldn't be loaded. */
export type EmbeddedFigures = ReadonlyMap<string, string | null>;

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
const optionText = (question: PaperQuestion, key: (typeof OPTION_KEYS)[number]) => question[`option${key}` as const];

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Text as HTML: escaped, line breaks kept, and the maths (\( \) and \[ \])
 * as MathML, which Chrome draws with the embedded math font.
 */
function richText(text: string | undefined): string {
  return splitLatex(text ?? "")
    .map((piece) => {
      if (piece.kind === "text") return escapeHtml(piece.value).replace(/\n/g, "<br>");
      try {
        return katex.renderToString(piece.value, {
          displayMode: piece.display,
          output: "mathml",
          throwOnError: false,
          strict: "ignore",
        });
      } catch {
        return escapeHtml(piece.value);
      }
    })
    .join("");
}

function figureTags(urls: string[], embedded: EmbeddedFigures): string {
  return urls
    .map((url) => {
      const data = embedded.get(url);
      return data ? `<img class="figure" src="${data}" alt="">` : '<p class="missing">Figure could not be loaded.</p>';
    })
    .join("");
}

function questionHtml(question: PaperQuestion, embedded: EmbeddedFigures): string {
  const options =
    question.answerType === "Numerical"
      ? []
      : OPTION_KEYS.filter((key) => optionText(question, key) || question.optionDiagramUrls[key].length);
  // Short options without figures fit two to a row, like a printed paper.
  const short = options.every(
    (key) => !question.optionDiagramUrls[key].length && optionText(question, key).replace(/\\[()[\]]/g, "").length <= 34
  );
  const optionList = options.length
    ? `<ol class="options${short ? " short" : ""}">${options
        .map(
          (key) =>
            `<li><span class="key">(${key})</span><span>${richText(optionText(question, key))}${figureTags(
              question.optionDiagramUrls[key],
              embedded
            )}</span></li>`
        )
        .join("")}</ol>`
    : "";
  return `<li class="question"><div class="stem">${richText(question.questionText)}</div>${figureTags(
    question.diagramUrls,
    embedded
  )}${optionList}</li>`;
}

const answerOf = (question: PaperQuestion) => (question.correctAnswer ? richText(question.correctAnswer) : "–");

/** Every figure the paper shows, each once. */
export function figureUrlsOf(paper: QuestionPaper): string[] {
  const urls = paper.questions.flatMap((q) => [
    ...q.diagramUrls,
    ...OPTION_KEYS.flatMap((key) => q.optionDiagramUrls[key]),
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
function fontFaces(): string {
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

export function questionPaperHtml(paper: QuestionPaper, embedded: EmbeddedFigures): string {
  const { questions } = paper;
  const chapters = [...new Set(questions.map((q) => q.chapter).filter(Boolean))];
  const marks = questions.length * paper.marksPerQuestion;

  const answerKey = paper.answerKey
    ? `<section><h2>Answer key</h2><div class="key-grid">${questions
        .map((q, i) => `<div><b>${i + 1}.</b> ${answerOf(q)}</div>`)
        .join("")}</div></section>`
    : "";
  const solutions = paper.solutions
    ? `<section><h2>Solutions</h2>${questions
        .map(
          (q, i) =>
            `<div class="solution"><h3>${i + 1}. Answer: ${answerOf(q)}</h3><div>${
              q.explanation ? richText(q.explanation) : "No solution available."
            }</div>${figureTags(q.explanationDiagramUrls, embedded)}</div>`
        )
        .join("")}</section>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.title)}</title>
<style>
  ${fontFaces()}
  @page { size: A4; margin: 14mm; }
  body { font-family: "Noto Sans", "Noto Sans Math", sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; margin: 0; }
  math { font-family: "Noto Sans Math", math; font-size: 1.05em; }
  h1 { font-size: 17pt; line-height: 1.25; margin: 0 0 3pt; }
  .meta { margin: 0; color: #3d3d3d; }
  .chapters { margin: 2pt 0 0; color: #666; font-size: 9.5pt; }
  .candidate { display: flex; gap: 18pt; margin: 10pt 0 14pt; padding: 7pt 0; border-top: 1px solid #9a9a9a; border-bottom: 1px solid #9a9a9a; font-size: 10pt; }
  .candidate span { flex: 1; display: flex; gap: 6pt; }
  .candidate span::after { content: ""; flex: 1; border-bottom: 1px solid #9a9a9a; }
  ol.questions { margin: 0; padding-left: 22pt; }
  li.question { margin: 0 0 13pt; padding-left: 2pt; break-inside: avoid; }
  .stem { margin-bottom: 4pt; }
  ol.options { list-style: none; margin: 3pt 0 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 3pt 18pt; }
  ol.options.short { grid-template-columns: 1fr 1fr; }
  ol.options li { display: flex; gap: 5pt; }
  .key { font-weight: 700; }
  img.figure { display: block; max-width: 100%; max-height: 190pt; margin: 4pt 0; }
  .missing { margin: 2pt 0; color: #888; font-size: 9pt; font-style: italic; }
  h2 { font-size: 13pt; margin: 0 0 9pt; break-before: page; }
  .key-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5pt 12pt; }
  .solution { margin: 0 0 11pt; break-inside: avoid; }
  .solution h3 { font-size: 10.5pt; margin: 0 0 2pt; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(paper.title)}</h1>
    <p class="meta">Class ${escapeHtml(paper.standard)} · ${escapeHtml(paper.subject)} · ${questions.length} questions · ${marks} marks (${paper.marksPerQuestion} each)</p>
    ${chapters.length ? `<p class="chapters">${chapters.map(escapeHtml).join(" · ")}</p>` : ""}
    <div class="candidate"><span>Name</span><span>Roll no.</span><span>Date</span></div>
  </header>
  <ol class="questions">${questions.map((q) => questionHtml(q, embedded)).join("")}</ol>
  ${answerKey}
  ${solutions}
</body>
</html>`;
}
