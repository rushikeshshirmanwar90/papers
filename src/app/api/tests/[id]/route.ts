import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { HttpError, badRequest, readJson, route, text } from "@/lib/http";
import { attemptOut, currentAttempt, questionsFor } from "@/lib/attempts";
import { maxScoreOf, mustEdit, readWhen, statusOf, testFor, testSummaries } from "@/lib/tests";
import TestAttempt from "@/models/TestAttempt";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * A test with its questions and answers, and every student of the batch with
 * their result (or that they haven't taken it), for the tuition and teachers.
 * Students get their own view (below).
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req);
  const { test, canEdit } = await testFor(session, params.id);

  // A student sees the test, their attempt, and the questions: without
  // answers while they're taking it, with answers once submitted or closed.
  if (session.role === "student") {
    if (statusOf(test) === "scheduled") throw new HttpError(404, "This test was not found.");
    const attempt = await currentAttempt(test, session);
    const submitted = !!attempt?.submittedAt;
    // Closed: answers for those who never started; anyone mid-test finishes first.
    const reveal = submitted || (statusOf(test) === "closed" && !attempt);
    return {
      test: (await testSummaries([test]))[0],
      attempt: attemptOut(test, attempt),
      // Before starting, only the summary; the questions come with the attempt.
      questions: attempt || reveal ? questionsFor(test, reveal) : [],
    };
  }

  const [students, attempts] = await Promise.all([
    User.find({ tuitionId: session.tuitionId, role: "student", batchId: test.batchId }).select("name").sort({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>(),
    TestAttempt.find({ testId: test._id }).lean<{ studentId: Types.ObjectId; score: number; correctCount: number; wrongCount: number; skippedCount: number; submittedAt: Date | null; timeTakenSeconds: number }[]>(),
  ]);
  const results = students.map((s) => {
    const a = attempts.find((x) => String(x.studentId) === String(s._id));
    return {
      student: { id: String(s._id), name: s.name },
      state: !a ? "not-started" : a.submittedAt ? "submitted" : "in-progress",
      score: a?.submittedAt ? a.score : null,
      correct: a?.correctCount ?? 0,
      wrong: a?.wrongCount ?? 0,
      skipped: a?.skippedCount ?? 0,
      submittedAt: a?.submittedAt ?? null,
      timeTakenSeconds: a?.timeTakenSeconds ?? 0,
    };
  });
  // Best first; those who haven't submitted last.
  results.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.student.name.localeCompare(b.student.name));

  return {
    test: (await testSummaries([test]))[0],
    canEdit,
    questions: test.questions,
    results,
  };
});

/** Edits the test: title, time limit, open and close times, or { closeNow: true }. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test, canEdit } = await testFor(session, params.id);
  mustEdit(canEdit);
  const body = await readJson(req);

  if (body.title !== undefined) test.title = text(body, "title", { required: true, max: 120, label: "a test name" })!;
  if (body.durationMinutes !== undefined) {
    const n = Number(body.durationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 600) throw badRequest("The time limit must be 1 to 600 minutes.");
    test.durationMinutes = n;
  }
  if (body.opensAt !== undefined) {
    const opensAt = readWhen(body.opensAt, "The start time", test.opensAt);
    if (!opensAt) throw badRequest("Set when the test opens.");
    if (statusOf(test) !== "scheduled" && opensAt.getTime() !== test.opensAt.getTime()) {
      throw badRequest("The test has already opened; its start time can't change.");
    }
    test.opensAt = opensAt;
  }
  if (body.closesAt !== undefined) test.closesAt = readWhen(body.closesAt, "The end time", test.closesAt);
  if (body.closeNow === true) test.closesAt = new Date();
  if (test.closesAt && test.closesAt < test.opensAt) throw badRequest("The test must close after it opens.");
  await test.save();
  return { test: (await testSummaries([test]))[0], maxScore: maxScoreOf(test) };
});

/** Deletes the test and everyone's attempts at it. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test, canEdit } = await testFor(session, params.id);
  mustEdit(canEdit);
  await TestAttempt.deleteMany({ testId: test._id });
  await test.deleteOne();
  return { ok: true };
});
