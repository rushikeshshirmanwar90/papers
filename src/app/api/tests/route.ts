import { requireUser } from "@/lib/auth";
import { badRequest, isObjectId, readJson, route, text } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { batchFor } from "@/lib/teaching";
import { readQuestions, readWhen, testSummaries } from "@/lib/tests";
import { Types } from "mongoose";
import TestAttempt from "@/models/TestAttempt";
import TestRoom, { type TestRoomDoc } from "@/models/TestRoom";

export const dynamic = "force-dynamic";

/**
 * Tests the user should see, newest first: the tuition's all, a teacher's
 * batches', a student's batch's. ?batchId= narrows to one batch.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const ids = await batchIdsOf(session);
  const filter: Record<string, unknown> = { tuitionId: session.tuitionId };
  if (ids !== "all") filter.batchId = { $in: ids };
  const only = req.nextUrl.searchParams.get("batchId");
  if (isObjectId(only)) filter.batchId = ids === "all" || ids.some((id) => String(id) === only) ? only : { $in: [] };
  // Students only see tests once they open.
  if (session.role === "student") filter.opensAt = { $lte: new Date() };
  const tests = (await TestRoom.find(filter).select("-questions.explanation").sort({ opensAt: -1 }).limit(200)) as TestRoomDoc[];
  const summaries = await testSummaries(tests);
  if (session.role !== "student") return { tests: summaries };

  // A student also sees where they are with each test.
  const attempts = await TestAttempt.find({ studentId: session.user._id, testId: { $in: tests.map((t) => t._id) } })
    .select("testId score submittedAt")
    .lean<{ testId: Types.ObjectId; score: number; submittedAt: Date | null }[]>();
  return {
    tests: summaries.map((t) => {
      const a = attempts.find((x) => String(x.testId) === t.id);
      return { ...t, mine: a ? { state: a.submittedAt ? "submitted" : "in-progress", score: a.submittedAt ? a.score : null } : null };
    }),
  };
});

const number = (value: unknown, fallback: number, min: number, max: number, label: string) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${label} must be from ${min} to ${max}.`);
  return n;
};

/**
 * Sets a test for a batch:
 * { batchId, title, durationMinutes, opensAt?, closesAt?, marksPerQuestion?, negativeMarks?, subject?, standard?, questions: […] }
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const body = await readJson(req);
  const batch = await batchFor(session, body.batchId);
  const opensAt = readWhen(body.opensAt, "The start time", new Date())!;
  const closesAt = readWhen(body.closesAt, "The end time", null);
  if (closesAt && closesAt <= opensAt) throw badRequest("The test must close after it opens.");

  const test = (await TestRoom.create({
    tuitionId: session.tuitionId,
    batchId: batch._id,
    teacherId: session.user._id,
    title: text(body, "title", { required: true, max: 120, label: "a test name" }),
    subject: text(body, "subject", { max: 40 }) ?? "",
    standard: text(body, "standard", { max: 10 }) ?? "",
    questions: readQuestions(body.questions),
    marksPerQuestion: number(body.marksPerQuestion, 4, 0, 100, "Marks per question"),
    negativeMarks: number(body.negativeMarks, 0, 0, 100, "Negative marks"),
    durationMinutes: number(body.durationMinutes, 60, 1, 600, "The time limit (minutes)"),
    opensAt,
    closesAt,
  })) as TestRoomDoc;
  return { test: (await testSummaries([test]))[0] };
});
