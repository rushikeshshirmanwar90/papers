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

export type TestStatus = "scheduled" | "open" | "closed";

export function statusOf(test: Pick<TestRoomDoc, "opensAt" | "closesAt">, now = Date.now()): TestStatus {
  if (test.opensAt.getTime() > now) return "scheduled";
  if (test.closesAt && test.closesAt.getTime() <= now) return "closed";
  return "open";
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

export const maxScoreOf = (test: Pick<TestRoomDoc, "questions" | "marksPerQuestion">) => test.questions.length * test.marksPerQuestion;

/** Tests as lists show them: when, how long, how many have taken it and the average. */
export async function testSummaries(tests: TestRoomDoc[]) {
  const ids = tests.map((t) => t._id);
  const [batches, teachers, stats, studentCounts] = await Promise.all([
    Batch.find({ _id: { $in: tests.map((t) => t.batchId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    User.find({ _id: { $in: tests.map((t) => t.teacherId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    TestAttempt.aggregate<{ _id: Types.ObjectId; submitted: number; avg: number }>([
      { $match: { testId: { $in: ids }, submittedAt: { $ne: null } } },
      { $group: { _id: "$testId", submitted: { $sum: 1 }, avg: { $avg: "$score" } } },
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
      status: statusOf(t, now),
      createdAt: t.createdAt,
      submitted: s?.submitted ?? 0,
      batchStudents: studentCounts.find((c) => String(c._id) === String(t.batchId))?.n ?? 0,
      averageScore: s ? Math.round(s.avg * 10) / 10 : null,
    };
  });
}
