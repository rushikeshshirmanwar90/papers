import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { HttpError, badRequest, readJson, route, text } from "@/lib/http";
import { attemptOut, currentAttempt, finalizeExpired, questionsFor, resultsReleased } from "@/lib/attempts";
import { maxScoreOf, mustEdit, readDuration, readMarking, readQuestions, readWhen, resolveSchedule, statusOf, testFor, testSummaries } from "@/lib/tests";
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
  // answers until the test has closed (submitting early doesn't release them).
  if (session.role === "student") {
    if (statusOf(test) === "scheduled") throw new HttpError(404, "This test was not found.");
    const attempt = await currentAttempt(test, session);
    // Closed: answers for everyone; anyone still mid-test was scored by currentAttempt.
    const reveal = resultsReleased(test);
    return {
      test: (await testSummaries([test]))[0],
      attempt: attemptOut(test, attempt),
      // Before starting, only the summary; the questions come with the attempt.
      questions: attempt || reveal ? questionsFor(test, reveal) : [],
    };
  }

  // Attempts whose time ran out while nobody was looking are scored before the results are listed.
  await finalizeExpired(test);
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

/**
 * Edits an upcoming test that no student has started: title, questions,
 * marking, time limit, and when it opens (or startNow) and closes. The same
 * schedule rules as setting one apply, checked against the clock now.
 * Once it has opened the only change is { closeNow: true }, on an open test.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test, canEdit } = await testFor(session, params.id);
  mustEdit(canEdit);
  const body = await readJson(req);
  const status = statusOf(test);

  if (body.closeNow === true) {
    if (status === "scheduled") throw badRequest("This test hasn't opened yet. Cancel it instead.");
    if (status === "closed") throw badRequest("This test has already closed.");
    test.closesAt = new Date();
    await test.save();
    // New starts are refused from now on; students still mid-test are scored with what they saved.
    await finalizeExpired(test);
    return { test: (await testSummaries([test]))[0], maxScore: maxScoreOf(test) };
  }

  if (status !== "scheduled") throw badRequest("This test has already opened, so it can't be edited. You can close it early.");
  if (await TestAttempt.exists({ testId: test._id })) throw badRequest("Students have already started this test, so it can't be edited.");

  if (body.title !== undefined) test.title = text(body, "title", { required: true, max: 120, label: "a test name" })!;
  if (body.questions !== undefined) test.set("questions", readQuestions(body.questions));
  const marking = readMarking(body, test);
  test.marksPerQuestion = marking.marksPerQuestion;
  test.negativeMarks = marking.negativeMarks;
  test.durationMinutes = readDuration(body.durationMinutes, test.durationMinutes);
  const { opensAt, closesAt } = resolveSchedule({
    startNow: body.startNow === true,
    opensAt: readWhen(body.opensAt, "The start time", test.opensAt),
    closesAt: readWhen(body.closesAt, "The end time", test.closesAt),
    durationMinutes: test.durationMinutes,
  });
  test.opensAt = opensAt;
  test.closesAt = closesAt;
  await test.save();
  return { test: (await testSummaries([test]))[0], maxScore: maxScoreOf(test) };
});

/** Cancels an upcoming test that no student has started. Questions in the bank are never touched. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test, canEdit } = await testFor(session, params.id);
  mustEdit(canEdit);
  if (statusOf(test) !== "scheduled") throw badRequest("This test has already opened, so it can't be cancelled. You can close it early.");
  if (await TestAttempt.exists({ testId: test._id })) throw badRequest("Students have already started this test, so it can't be cancelled.");
  await test.deleteOne();
  return { ok: true };
});
