import type { PaperQuestion, QuestionPaper } from "./html";

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

export function parsePaper(body: unknown): QuestionPaper {
  if (!isRecord(body)) throw new PaperRequestError("Send the paper as a JSON object");
  const { questions, marksPerQuestion } = body;
  if (!Array.isArray(questions) || questions.length === 0) throw new PaperRequestError("Add at least one question");
  if (questions.length > MAX_QUESTIONS) throw new PaperRequestError(`A paper can have at most ${MAX_QUESTIONS} questions`);
  if (typeof marksPerQuestion !== "number" || !Number.isFinite(marksPerQuestion) || marksPerQuestion < 0 || marksPerQuestion > 100) {
    throw new PaperRequestError("marksPerQuestion must be a number from 0 to 100");
  }
  return {
    title: text(body.title, "title", 200).trim() || "Question paper",
    standard: text(body.standard, "standard", 40),
    subject: text(body.subject, "subject", 80),
    marksPerQuestion,
    answerKey: body.answerKey === true,
    solutions: body.solutions === true,
    questions: questions.map(question),
  };
}
