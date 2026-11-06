import { requireUser } from "@/lib/auth";
import { EXAMS, examSubjectProblem, isExamId, type ExamId } from "@/lib/examBank";
import { badRequest, isObjectId, readJson, route } from "@/lib/http";
import { LEVELS, MAX_EXCLUDED, MAX_PICK, pickFromBank, type Mix, type PickRequest, type Quota } from "@/lib/questionPick";

export const dynamic = "force-dynamic";

const MAX_NAMES = 200;
const MAX_NAME_LENGTH = 300;

function names(body: Record<string, unknown>, field: string): string[] {
  const value = body[field] ?? [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be a list.`);
  if (value.length > MAX_NAMES) throw badRequest(`${field} has too many entries.`);
  const list = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item.length > MAX_NAME_LENGTH) throw badRequest(`${field} must be a list of names.`);
    return item.trim();
  });
  return [...new Set(list)];
}

function whole(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function quotaOf(body: Record<string, unknown>): Quota {
  if (body.mix === undefined || body.mix === null) return { kind: "any", count: whole(body.count, "The number of questions", 1, MAX_PICK) };
  const raw = body.mix;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("mix must list how many of each level.");
  const entries = raw as Record<string, unknown>;
  const mix = Object.fromEntries(LEVELS.map((level) => [level, whole(entries[level] ?? 0, `The number of ${level} questions`, 0, MAX_PICK)])) as Mix;
  const total = LEVELS.reduce((sum, level) => sum + mix[level], 0);
  if (total < 1 || total > MAX_PICK) throw badRequest(`Ask for 1 to ${MAX_PICK} questions in all.`);
  return { kind: "mix", mix };
}

/**
 * Picks questions at random for a PDF: a number of them (or a number of each
 * level) from one exam's questions in a subject and chapters. Returns only
 * real bank questions, how many were found against how many were asked for,
 * and how many exist; it never tops up from another exam, subject or chapter.
 *
 * Teachers and tuition accounts only, like making the PDF itself. The question
 * bank is shared by every institute, so nothing here is institute-specific.
 */
export const POST = route(async (req) => {
  await requireUser(req, "teacher", "tuition");
  const body = await readJson(req);

  const exam = body.exam;
  if (!isExamId(exam)) throw badRequest(`Choose an exam: ${Object.keys(EXAMS).join(" or ")}.`);
  const subject = body.subject;
  if (typeof subject !== "string" || !subject) throw badRequest("Choose a subject.");
  const problem = examSubjectProblem(exam as ExamId, subject);
  if (problem) throw badRequest(problem);

  const answerType = body.answerType ?? "any";
  if (answerType !== "MCQ" && answerType !== "Numerical" && answerType !== "any") throw badRequest("answerType must be MCQ, Numerical or any.");

  const excludeRaw = body.exclude ?? [];
  if (!Array.isArray(excludeRaw) || excludeRaw.length > MAX_EXCLUDED || !excludeRaw.every(isObjectId)) {
    throw badRequest(`exclude must be a list of up to ${MAX_EXCLUDED} question ids.`);
  }

  const request: PickRequest = {
    exam: exam as ExamId,
    subject,
    chapters: names(body, "chapters"),
    topics: names(body, "topics"),
    quota: quotaOf(body),
    answerType,
    exclude: [...new Set(excludeRaw as string[])],
  };
  const result = await pickFromBank(request);
  return { ...result, complete: result.found >= result.requested };
});
