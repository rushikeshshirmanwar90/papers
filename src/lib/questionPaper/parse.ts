import { DEFAULT_PAPER_TITLE, type PaperQuestion, type QuestionPaper } from "./html";
import { normalizeSlideSettings } from "../smartSlides/layout";
import { normalizePaperStyle } from "./style";
import { cleanWatermark } from "./watermark";

// Checks a request body and turns it into a QuestionPaper, with limits so one
// request can't ask for an unbounded amount of work.

export const MAX_QUESTIONS = 300;
const MAX_TEXT = 20000;
const MAX_FIGURES_PER_LIST = 12;

export class PaperRequestError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, field: string, max = MAX_TEXT): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new PaperRequestError(`${field} must be text`);
  if (value.length > max) throw new PaperRequestError(`${field} is too long`);
  return value;
}

function urls(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PaperRequestError(`${field} must be a list`);
  const list = value.filter((url): url is string => typeof url === "string" && url !== "" && url.length <= 2000);
  if (list.length > MAX_FIGURES_PER_LIST) throw new PaperRequestError(`${field} has too many figures`);
  return list;
}

function question(raw: unknown, index: number): PaperQuestion {
  const at = `questions[${index}]`;
  if (!isRecord(raw)) throw new PaperRequestError(`${at} must be an object`);
  const options = isRecord(raw.optionDiagramUrls) ? raw.optionDiagramUrls : {};
  return {
    questionText: text(raw.questionText, `${at}.questionText`),
    optionA: text(raw.optionA, `${at}.optionA`),
    optionB: text(raw.optionB, `${at}.optionB`),
    optionC: text(raw.optionC, `${at}.optionC`),
    optionD: text(raw.optionD, `${at}.optionD`),
    answerType: text(raw.answerType, `${at}.answerType`, 40) || "MCQ",
    correctAnswer: text(raw.correctAnswer, `${at}.correctAnswer`),
    explanation: text(raw.explanation, `${at}.explanation`),
    chapter: text(raw.chapter, `${at}.chapter`, 300),
    source: text(raw.source, `${at}.source`, 200),
    diagramUrls: urls(raw.diagramUrls, `${at}.diagramUrls`),
    optionDiagramUrls: {
      A: urls(options.A, `${at}.optionDiagramUrls.A`),
      B: urls(options.B, `${at}.optionDiagramUrls.B`),
      C: urls(options.C, `${at}.optionDiagramUrls.C`),
      D: urls(options.D, `${at}.optionDiagramUrls.D`),
    },
    explanationDiagramUrls: urls(raw.explanationDiagramUrls, `${at}.explanationDiagramUrls`),
  };
}

/** The exam's length in minutes: a whole number up to a day, or none. */
function duration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1440) {
    throw new PaperRequestError("durationMinutes must be a whole number of minutes from 0 to 1440");
  }
  return value > 0 ? value : null;
}

/** A day as yyyy-mm-dd, or none. */
function day(value: unknown): string {
  const date = text(value, "date", 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PaperRequestError("date must be yyyy-mm-dd");
  return date;
}

export function parsePaper(body: unknown): QuestionPaper {
  if (!isRecord(body)) throw new PaperRequestError("Send the paper as a JSON object");
  const { questions, marksPerQuestion } = body;
  // A Smart PDF shows the questions only: never an answer key or solutions.
  const smart = body.format === "smart";
  const questionPaper = smart || body.questionPaper !== false;
  const answerKey = !smart && body.answerKey === true;
  const solutions = !smart && body.solutions === true;
  if (!questionPaper && !answerKey && !solutions) throw new PaperRequestError("Choose what to print: the questions, the answer key or the solutions");
  if (!Array.isArray(questions) || questions.length === 0) throw new PaperRequestError("Add at least one question");
  if (questions.length > MAX_QUESTIONS) throw new PaperRequestError(`A paper can have at most ${MAX_QUESTIONS} questions`);
  if (typeof marksPerQuestion !== "number" || !Number.isFinite(marksPerQuestion) || marksPerQuestion < 0 || marksPerQuestion > 100) {
    throw new PaperRequestError("marksPerQuestion must be a number from 0 to 100");
  }
  return {
    title: text(body.title, "title", 200).trim() || DEFAULT_PAPER_TITLE,
    // Filled in by the route from the account's tuition, never from the request.
    institute: "",
    standard: text(body.standard, "standard", 40),
    subject: text(body.subject, "subject", 80),
    marksPerQuestion,
    paperSet: text(body.paperSet, "paperSet", 20).trim() || "1",
    date: day(body.date),
    durationMinutes: duration(body.durationMinutes),
    questionPaper,
    answerKey,
    solutions,
    strictLayout: body.strictLayout === true,
    questions: questions.map(question),
    // Exam papers only: a Smart PDF never carries a watermark.
    watermark: smart ? "" : cleanWatermark(text(body.watermark, "watermark", 500)),
    // Exam papers only, and only values from fixed lists: a Smart PDF has its own settings.
    ...(smart ? {} : { style: normalizePaperStyle(body.style) }),
    ...(smart ? { format: "smart" as const, slides: normalizeSlideSettings(body.slides) } : {}),
  };
}
