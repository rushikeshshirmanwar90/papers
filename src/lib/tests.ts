import { Types } from "mongoose";
import type { Session } from "@/lib/auth";
import { HttpError, badRequest, isObjectId, notFound } from "@/lib/http";
import { batchFor } from "@/lib/teaching";
import Batch from "@/models/Batch";
import TestAttempt from "@/models/TestAttempt";
import TestRoom, { type TestQuestion, type TestRoomDoc } from "@/models/TestRoom";
import User from "@/models/User";

export const MAX_TEST_QUESTIONS = 300;
const MAX_TEXT = 20000;

/**
 * Where a test is in its life. It is worked out from opensAt and closesAt (UTC)
 * every time, never stored, so it can't disagree with the times.
 */
export type TestStatus = "scheduled" | "open" | "closed";

export function statusOf(test: Pick<TestRoomDoc, "opensAt" | "closesAt">, now = Date.now()): TestStatus {
  if (test.opensAt.getTime() > now) return "scheduled";
  if (test.closesAt && test.closesAt.getTime() <= now) return "closed";
  return "open";
}

/** The latest a student can start and still get the whole time limit: the test closes then, minus its duration. */
export function lastStartOf(test: Pick<TestRoomDoc, "closesAt" | "durationMinutes">): Date | null {
  return test.closesAt ? new Date(test.closesAt.getTime() - test.durationMinutes * 60 * 1000) : null;
}

const MINUTE = 60 * 1000;
const zone = { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } as const;
const inIndia = (date: Date) => date.toLocaleString("en-IN", zone);

/**
 * When a test opens and closes, checked against the clock at this moment.
 * `startNow` takes the opening time from the server's clock, not the phone's.
 * The window between the two must fit the whole time limit, so a student who
 * starts at the last permitted moment still gets all of it.
 */
export function resolveSchedule(input: { startNow: boolean; opensAt: Date | null; closesAt: Date | null; durationMinutes: number }, now = Date.now()) {
  const opensAt = input.startNow ? new Date(now) : input.opensAt;
  if (!opensAt) throw badRequest("Pick when the test opens, or start it now.");
  if (!input.startNow && opensAt.getTime() <= now) throw badRequest("The opening time has already passed. Pick a time from now on.");
  const closesAt = input.closesAt;
  if (!closesAt) throw badRequest("Pick when the test closes.");
  if (closesAt.getTime() <= opensAt.getTime()) throw badRequest("The test must close after it opens.");
  if (closesAt.getTime() - opensAt.getTime() < input.durationMinutes * MINUTE) {
    throw badRequest(
      `The test is open from ${inIndia(opensAt)} to ${inIndia(closesAt)}, which is shorter than its ${input.durationMinutes}-minute time limit. Close it later or shorten the time limit.`
    );
  }
  return { opensAt, closesAt };
}

/** Marks for a right answer and taken off for a wrong one. */
export function readMarking(body: Record<string, unknown>, current = { marksPerQuestion: 4, negativeMarks: 0 }) {
  const read = (value: unknown, fallback: number, min: number, label: string) => {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > 100) throw badRequest(`${label} must be from ${min} to 100.`);
    return Math.round(n * 100) / 100;
  };
  const marksPerQuestion = read(body.marksPerQuestion, current.marksPerQuestion, 1, "Marks for a right answer");
  const negativeMarks = read(body.negativeMarks, current.negativeMarks, 0, "Marks taken off for a wrong answer");
  if (negativeMarks > marksPerQuestion) throw badRequest("Marks taken off can't be more than the marks for a right answer.");
  return { marksPerQuestion, negativeMarks };
}

export function readDuration(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 600) throw badRequest("The time limit must be 1 to 600 minutes.");
  return n;
}

const str = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.slice(0, max) : "");
const urlList = (value: unknown) =>
  Array.isArray(value) ? value.filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 2000).slice(0, 12) : [];

/** The test's questions from the app: copies of bank questions, possibly edited by the teacher. */
export function readQuestions(value: unknown): TestQuestion[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest("Pick at least one question.");
  if (value.length > MAX_TEST_QUESTIONS) throw badRequest(`A test can have at most ${MAX_TEST_QUESTIONS} questions.`);
  return value.map((raw, i) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const questionText = str(q.questionText);
    if (!questionText.trim()) throw badRequest(`Question ${i + 1} has no text.`);
    const answerType = ["MCQ", "Numerical"].includes(String(q.answerType)) ? String(q.answerType) : "MCQ";
    const correctAnswer = str(q.correctAnswer, 100).trim();
    if (answerType === "MCQ" && correctAnswer && !/^[ABCD]$/.test(correctAnswer)) {
      throw badRequest(`Question ${i + 1}'s answer must be A, B, C or D.`);
    }
    const options = (q.optionDiagramUrls ?? {}) as Record<string, unknown>;
    return {
      sourceId: isObjectId(q._id) ? new Types.ObjectId(q._id) : null,
      subject: str(q.subject, 40),
      standard: str(q.standard, 10),
      chapter: str(q.chapter, 200),
      topic: str(q.topic, 200),
      difficulty: str(q.difficulty, 20),
      questionText,
      optionA: str(q.optionA),
      optionB: str(q.optionB),
      optionC: str(q.optionC),
      optionD: str(q.optionD),
      answerType,
      correctAnswer,
      explanation: str(q.explanation),
      diagramUrls: urlList(q.diagramUrls),
      optionDiagramUrls: { A: urlList(options.A), B: urlList(options.B), C: urlList(options.C), D: urlList(options.D) },
      explanationDiagramUrls: urlList(q.explanationDiagramUrls),
    };
  });
}

export function readWhen(value: unknown, label: string, fallback: Date | null): Date | null {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest(`${label} isn't a valid date and time.`);
  return date;
}

/** The test, if the user may see it; and whether they may change it (the tuition, or the teacher who set it). */
export async function testFor(session: Session, id: unknown) {
  if (!isObjectId(id)) throw notFound("This test");
  const test = (await TestRoom.findOne({ _id: id, tuitionId: session.tuitionId })) as TestRoomDoc | null;
  if (!test) throw notFound("This test");
  await batchFor(session, test.batchId).catch(() => {
    throw notFound("This test");
  });
  const canEdit = session.role === "tuition" || (session.role === "teacher" && String(test.teacherId) === session.userId);
  return { test, canEdit };
}

export function mustEdit(canEdit: boolean) {
  if (!canEdit) throw new HttpError(403, "Only the teacher who set this test (or the tuition) can change it.");
}

export const maxScoreOf = (test: Pick<TestRoomDoc, "questions" | "marksPerQuestion">) => Math.round(test.questions.length * test.marksPerQuestion * 100) / 100;

/** Tests as lists show them: when, how long, how many have taken it and the average. */
export async function testSummaries(tests: TestRoomDoc[]) {
  const ids = tests.map((t) => t._id);
  const [batches, teachers, stats, studentCounts] = await Promise.all([
    Batch.find({ _id: { $in: tests.map((t) => t.batchId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    User.find({ _id: { $in: tests.map((t) => t.teacherId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    TestAttempt.aggregate<{ _id: Types.ObjectId; started: number; submitted: number; avg: number | null }>([
      { $match: { testId: { $in: ids } } },
      {
        $group: {
          _id: "$testId",
          started: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $ne: ["$submittedAt", null] }, 1, 0] } },
          avg: { $avg: { $cond: [{ $ne: ["$submittedAt", null] }, "$score", null] } },
        },
      },
    ]),
    User.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { role: "student", batchId: { $in: tests.map((t) => t.batchId) } } },
      { $group: { _id: "$batchId", n: { $sum: 1 } } },
    ]),
  ]);
  const now = Date.now();
  return tests.map((t) => {
    const s = stats.find((x) => String(x._id) === String(t._id));
    return {
      id: String(t._id),
      title: t.title,
      batch: { id: String(t.batchId), name: batches.find((b) => String(b._id) === String(t.batchId))?.name ?? "" },
      teacher: { id: String(t.teacherId), name: teachers.find((u) => String(u._id) === String(t.teacherId))?.name ?? "" },
      subject: t.subject,
      standard: t.standard,
      questionCount: t.questions.length,
      marksPerQuestion: t.marksPerQuestion,
      negativeMarks: t.negativeMarks,
      maxScore: maxScoreOf(t),
      durationMinutes: t.durationMinutes,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      lastStartAt: lastStartOf(t),
      status: statusOf(t, now),
      createdAt: t.createdAt,
      /** Students who have opened it, finished or not: once any have, it can't be edited. */
      started: s?.started ?? 0,
      submitted: s?.submitted ?? 0,
      batchStudents: studentCounts.find((c) => String(c._id) === String(t.batchId))?.n ?? 0,
      averageScore: s?.avg != null ? Math.round(s.avg * 10) / 10 : null,
    };
  });
}
