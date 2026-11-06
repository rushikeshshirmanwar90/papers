import { examSourcePattern, examSubjectProblem, EXAMS, isExamId, type ExamId } from "@/lib/examBank";
import { badRequest } from "@/lib/http";
import { BANK_SUBJECTS } from "@/lib/syllabus";
import type { SchoolSubject } from "@/lib/school";

// ?exam=JEE or ?exam=NEET on /api/questions, /api/filters and the question
// picker: only the questions asked in that exam (see lib/examBank.ts). With no
// exam given nothing changes, so existing callers see what they always did.

/** The exam named by ?exam=, or null when none is. Anything but a known exam is a 400. */
export function examOf(params: URLSearchParams): ExamId | null {
  const value = params.get("exam")?.trim();
  if (!value || value === "All") return null;
  if (!isExamId(value)) throw badRequest(`Choose an exam: ${Object.keys(EXAMS).join(" or ")}.`);
  return value;
}

/** Mongo conditions (for $and) that keep one exam's questions: the JEE/NEET bank, and a source naming the exam. */
export function examConditions(exam: ExamId): Record<string, unknown>[] {
  return [{ examCategory: "JEE/NEET" }, { source: { $regex: examSourcePattern(exam), $options: "i" } }];
}

/** The question bank's names for a subject of an exam (Biology may be filed as Botany and Zoology). */
export const bankSubjects = (subject: string): string[] => BANK_SUBJECTS[subject as SchoolSubject] ?? [subject];

export interface ExamFilter {
  exam: ExamId;
  conditions: Record<string, unknown>[];
  /** The bank's names for the requested subject; null when no subject was asked for. */
  subjects: string[] | null;
}

/**
 * The conditions for the request's ?exam=, or null without one. The exam must
 * suit the rest of the request: its subject must be one the exam has and its
 * examCategory (if given) the bank's own, so an exam never quietly returns
 * another's questions.
 */
export function examFilterOf(params: URLSearchParams): ExamFilter | null {
  const exam = examOf(params);
  if (!exam) return null;
  const category = params.get("examCategory")?.trim();
  if (category && category !== "All" && category !== "JEE/NEET") throw badRequest(`${EXAMS[exam].label} has no ${category} questions.`);
  const subject = params.get("subject")?.trim();
  const asked = subject && subject !== "All" ? subject : null;
  const problem = asked ? examSubjectProblem(exam, asked) : null;
  if (problem) throw badRequest(problem);
  return { exam, conditions: examConditions(exam), subjects: asked ? bankSubjects(asked) : null };
}
