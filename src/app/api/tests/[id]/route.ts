import { endTest } from "@/lib/attempt-control";
import { accessOf, hasManagedAccess, audienceBatches, batchesOfTest, sharedScope, mustBeBankQuestions } from '@/lib/test-access';
import { readTestSubjects, validateSubjectQuestions } from '@/lib/test-access';
import { withTestLock } from '@/lib/test-lock';
import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { HttpError, badRequest, readJson, route, text } from "@/lib/http";
import { attemptOut, currentAttempt, finalizeExpired, questionsFor, resultsReleased } from "@/lib/attempts";
import { maxScoreOf, mustEdit, readDuration, readMarking, readQuestions, readWhen, resolveSchedule, statusOf, testFor, testSummaries } from "@/lib/tests";
import { ownAnalytics } from "@/lib/test-results";
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
    const access = await accessOf(test, session);
    if (!access.allowed || (hasManagedAccess(test) && statusOf(test) === 'scheduled')) return { test: { ...(await testSummaries([test]))[0], averageScore: null, started: 0, submitted: 0, batchStudents: 0 }, access, attempt: null, questions: [], analytics: null };
    if (statusOf(test) === "scheduled") throw new HttpError(404, "This test was not found.");
    const attempt = await currentAttempt(test, session);
    // Closed: answers for everyone; anyone still mid-test was scored by currentAttempt.
    const reveal = (await resultsReleased(test));
    return {
      test: (await testSummaries([test]))[0],
      access,
      attempt: await attemptOut(test, attempt),
      // Before starting, only the summary; the questions come with the attempt.
      questions: attempt || reveal ? questionsFor(test, reveal) : [],
      // Own rank and topic performance: only for a submitted attempt, and only once the test has closed.
      analytics: attempt?.submittedAt && reveal ? await ownAnalytics(test, attempt.toObject()) : null,
    };
  }

  // Attempts whose time ran out while nobody was looking are scored before the results are listed.
  await finalizeExpired(test);
  const [students, attempts] = await Promise.all([
    User.find({ tuitionId: session.tuitionId, role: "student", ...(hasManagedAccess(test) ? { _id: { $in: (test.roster ?? []).map(r => r.studentId) } } : { batchId: test.batchId }) }).select("name").sort({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>(),
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
    questions: statusOf(test) === "scheduled" ? test.questions : questionsFor(test, await resultsReleased(test)),
    results: (await resultsReleased(test)) ? results : [],
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
    const ended = await endTest(test);
    return { test: (await testSummaries([ended]))[0], maxScore: maxScoreOf(ended) };
  }

  if (status !== "scheduled") throw badRequest("This test has already opened, so it can't be edited. You can close it early.");
  if (await TestAttempt.exists({ testId: test._id })) throw badRequest("Students have already started this test, so it can't be edited.");

  const edited = await withTestLock(test, async (fresh, dbSession) => {
    if (statusOf(fresh) !== 'scheduled' || await TestAttempt.exists({ testId: fresh._id }).session(dbSession)) throw badRequest("This test has already opened or students have started, so it can't be edited.");
    if (body.title !== undefined) fresh.title = text(body, "title", { required: true, max: 120, label: "a test name" })!;
    if (body.questions !== undefined) {
      const subjects = readTestSubjects({ subjects: fresh.subject.split(',').map(s => s.trim()) });
      const batches = await audienceBatches(session, batchesOfTest(fresh).map(String), subjects[0]);
      const scope = sharedScope(batches, subjects[0], fresh.standard);
      const questions = readQuestions(body.questions);
      if (subjects.length === 1) await mustBeBankQuestions(scope, questions);
      else await validateSubjectQuestions(batches, subjects, fresh.standard, questions);
      fresh.set('questions', questions);
    }
    const marking = readMarking(body, fresh);
    fresh.marksPerQuestion = marking.marksPerQuestion;
    fresh.negativeMarks = marking.negativeMarks;
    fresh.durationMinutes = readDuration(body.durationMinutes, fresh.durationMinutes);
    const { opensAt, closesAt } = resolveSchedule({
      startNow: body.startNow === true,
      opensAt: readWhen(body.opensAt, "The start time", fresh.opensAt),
      closesAt: readWhen(body.closesAt, "The end time", fresh.closesAt),
      durationMinutes: fresh.durationMinutes,
    });
    fresh.opensAt = opensAt;
    fresh.closesAt = closesAt;
    await fresh.save({ session: dbSession });
    return fresh;
  });
  return { test: (await testSummaries([edited]))[0], maxScore: maxScoreOf(edited) };
});

/** Cancels an upcoming test that no student has started. Questions in the bank are never touched. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test, canEdit } = await testFor(session, params.id);
  mustEdit(canEdit);
  if (statusOf(test) !== "scheduled") throw badRequest("This test has already opened, so it can't be cancelled. You can close it early.");
  if (await TestAttempt.exists({ testId: test._id })) throw badRequest("Students have already started this test, so it can't be cancelled.");
  await withTestLock(test, async (fresh, dbSession) => {
    if (statusOf(fresh) !== 'scheduled' || await TestAttempt.exists({ testId: fresh._id }).session(dbSession)) throw badRequest("This test has already opened or students have started, so it can't be cancelled.");
    await fresh.deleteOne({ session: dbSession });
  });
  return { ok: true };
});
