import { reconcileVisibilityLocked } from "@/lib/attempt-visibility";
import { VISIBILITY_GRACE_MS } from "@/lib/exam-visibility-policy";
import { claimStart, requireTestAccess } from '@/lib/test-access';
import type { ClientSession } from "mongoose";
import { withTestLock } from "@/lib/test-lock";
import { completionReleased } from "@/lib/test-completion";
import type { Session } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { cleanAnswer, scoreAnswers } from "@/lib/marking";
import { lastStartOf, statusOf } from "@/lib/tests";
import TestAttempt, { type TestAttemptDoc } from "@/models/TestAttempt";
import type { TestRoomDoc } from "@/models/TestRoom";

// A student's go at a test: started when they open it, saved as they answer,
// and scored when they submit or their time runs out. The server has no timers
// (it runs on Vercel), so an attempt whose time is up is scored by the next
// request that touches it.



/** Thrown when an attempt can no longer change: it was submitted, or its time is up. */
export class AttemptClosedError extends HttpError {}

/** When the attempt's time is up: its time limit, or the test closing, whichever is first. */
export function deadlineOf(test: TestRoomDoc, attempt: Pick<TestAttemptDoc, "startedAt" | "individualDeadline">): Date {
  const byLimit = attempt.startedAt.getTime() + test.durationMinutes * 60 * 1000;
  const effective = attempt.individualDeadline?.getTime() ?? (test.closesAt ? Math.min(byLimit, test.closesAt.getTime()) : byLimit);
  return new Date(test.manuallyEndedAt ? Math.min(effective, test.manuallyEndedAt.getTime()) : effective);
}

/** Answers, correctness flags and solutions are released once the test has closed, not when one student submits. */
export const resultsReleased = (test: TestRoomDoc) =>
  test.opensAt.getTime() <= Date.now() && test.closesAt?.getTime() <= Date.now()
    ? completionReleased(test) : Promise.resolve(false);

const expired = (test: TestRoomDoc, attempt: Pick<TestAttemptDoc, "startedAt" | "individualDeadline" | "suspendedAt">, now = Date.now()) =>
  !!test.manuallyEndedAt || (!attempt.suspendedAt && now >= deadlineOf(test, attempt).getTime());

/** Score the latest saved answers while holding the room transaction lock. */
export async function finalizeLocked(test: TestRoomDoc, current: TestAttemptDoc, session: ClientSession, now = new Date(), force = false): Promise<TestAttemptDoc> {
  if (current.submittedAt || (current.suspendedAt && !force)) return current;
  const given = new Map(current.answers.map(a => [a.index, a.selected]));
  const result = scoreAnswers(test.questions, given, test.marksPerQuestion, test.negativeMarks);
  const deadline = deadlineOf(test, current);
  const end = current.suspendedAt ? current.suspendedAt : now > deadline ? deadline : now;
  const done = await TestAttempt.findOneAndUpdate({ _id: current._id, submittedAt: null, rev: (current.rev ?? 0) === 0 ? { $in: [0, null] } : current.rev }, {
    $set: { answers: result.answers, score: result.score, maxScore: result.maxScore,
      correctCount: result.correctCount, wrongCount: result.wrongCount, skippedCount: result.skippedCount,
      submittedAt: end, suspendedAt: null,
      timeTakenSeconds: Math.max(0, Math.round((end.getTime() - current.startedAt.getTime()) / 1000)) },
    $inc: { rev: 1 },
  }, { returnDocument: 'after', session }) as TestAttemptDoc | null;
  if (!done) throw new HttpError(409, "Attempt changed. Try again.");
  return done;
}

export async function finalize(test: TestRoomDoc, attempt: TestAttemptDoc, now = new Date(), expiryOnly = false, expectedResumeVersion = attempt.resumeVersion ?? 0): Promise<TestAttemptDoc> {
  return withTestLock(test, async (fresh, session) => {
    const read = await TestAttempt.findById(attempt._id).session(session) as TestAttemptDoc;
    const current = await reconcileVisibilityLocked(fresh, read, session, now);
    if (!expiryOnly && (current.resumeVersion ?? 0) !== expectedResumeVersion) return current;
    // Re-read under the same lock as extensions: an old expiry request cannot
    // finalize an attempt whose deadline was just extended.
    if (expiryOnly && !expired(fresh, current, now.getTime())) return current;
    return finalizeLocked(fresh, current, session, now, !!fresh.manuallyEndedAt);
  });
}

/** The student's attempt at the test, finished first if its time ran out while they were away. */
export async function currentAttempt(test: TestRoomDoc, session: Session): Promise<TestAttemptDoc | null> {
  const attempt = (await TestAttempt.findOne({ testId: test._id, studentId: session.user._id })) as TestAttemptDoc | null;
  if (attempt && !attempt.submittedAt && (attempt.visibility || expired(test, attempt))) return finalize(test, attempt, new Date(), true);
  return attempt;
}

/**
 * Scores every unsubmitted attempt of the test whose time is up (all of them
 * once the test has been closed). Run when a teacher closes or opens a test.
 */
export async function finalizeExpired(test: TestRoomDoc): Promise<number> {
  const open = (await TestAttempt.find({ testId: test._id, submittedAt: null })) as TestAttemptDoc[];
  let n = 0;
  for (const attempt of open) {
    if (!attempt.visibility && !expired(test, attempt)) continue;
    await finalize(test, attempt, new Date(), true);
    n++;
  }
  return n;
}

export async function startAttempt(test: TestRoomDoc, session: Session, visibility = false): Promise<TestAttemptDoc> {
  await requireTestAccess(test, session);
  const existing = await currentAttempt(test, session);
  if (existing) return existing;
  const status = statusOf(test);
  if (status === "scheduled") throw new HttpError(400, "This test hasn't opened yet.");
  if (status === "closed") throw new HttpError(400, "This test has closed.");
  // Starting late would cut the time limit short, so the last start is closing time minus the time limit.
  const lastStart = lastStartOf(test);
  if (test.accessVersion !== 1 && lastStart && Date.now() > lastStart.getTime()) throw new HttpError(400, "It's too late to start this test: there isn't enough time left for the full time limit.");
  await claimStart(test, session);
  return withTestLock(test, async (fresh, dbSession) => {
    const previous = await TestAttempt.findOne({ testId: fresh._id, studentId: session.user._id }).session(dbSession) as TestAttemptDoc | null;
    if (previous) return previous;
    if (fresh.manuallyEndedAt || fresh.closesAt.getTime() <= Date.now()) throw new HttpError(400, "This test has closed.");
    const [created] = await TestAttempt.create([{
      tuitionId: fresh.tuitionId, testId: fresh._id, batchId: session.user.batchId ?? fresh.batchId,
      studentId: session.user._id, startedAt: new Date(), answers: [],
      ...(visibility ? { visibility: { clientId: `initial_${Date.now()}_${String(session.user._id)}`, sequence: 0, lastSeenAt: new Date(), retiredClients: [] } } : {}), maxScore: fresh.questions.length * fresh.marksPerQuestion,
    }], { session: dbSession });
    return created as TestAttemptDoc;
  });
}

/** The answers in a request, checked: each must name a question of the test and hold a valid answer (or be blank to clear it). */
function readAnswers(test: TestRoomDoc, raw: unknown): Map<number, string | null> {
  if (!Array.isArray(raw)) throw new HttpError(400, "Send the answers as a list.");
  if (raw.length > test.questions.length) throw new HttpError(400, "There are more answers than questions.");
  const out = new Map<number, string | null>();
  for (const entry of raw) {
    const { index, selected } = (entry ?? {}) as { index?: unknown; selected?: unknown };
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= test.questions.length) {
      throw new HttpError(400, "An answer is for a question that isn't in this test.");
    }
    const clean = cleanAnswer(test.questions[index as number], selected);
    const blank = selected === null || selected === undefined || (typeof selected === "string" && !selected.trim());
    if (clean === null && !blank) throw new HttpError(400, `That isn't a valid answer for question ${(index as number) + 1}.`);
    out.set(index as number, clean);
  }
  return out;
}

/**
 * Saves validated answers under the same transaction lock as teacher controls
 * and scoring. Repeated saves cannot undo a finalized or suspended attempt.
 */
async function saveLocked(test: TestRoomDoc, attempt: TestAttemptDoc, raw: unknown, session: ClientSession) {
  if (attempt.submittedAt || expired(test, attempt)) throw new AttemptClosedError(400, "This attempt has ended.");
  if (attempt.suspendedAt) throw new AttemptClosedError(409, "Test paused due to violations.");
  const entries = readAnswers(test, raw);
  const answers = new Map(attempt.answers.map(a => [a.index, { index: a.index, selected: a.selected, correct: a.correct }]));
  for (const [index, selected] of entries) answers.set(index, { index, selected, correct: null });
  const done = await TestAttempt.findOneAndUpdate({ _id: attempt._id, submittedAt: null, suspendedAt: null,
    rev: (attempt.rev ?? 0) === 0 ? { $in: [0, null] } : attempt.rev, $expr: { $lt: ["$$NOW", deadlineOf(test, attempt)] } }, {
    $set: { answers: [...answers.values()] }, $inc: { rev: 1 },
  }, { returnDocument: 'after', session }) as TestAttemptDoc | null;
  if (!done) throw new AttemptClosedError(409, "This attempt is paused or has ended.");
  return done;
}

export async function saveAnswers(test: TestRoomDoc, attempt: TestAttemptDoc, raw: unknown, resumeVersion?: unknown) {
  const result = await withTestLock(test, async (fresh, session) => {
    const read = await TestAttempt.findById(attempt._id).session(session) as TestAttemptDoc;
    const current = await reconcileVisibilityLocked(fresh, read, session);
    // Commit a newly detected suspension before returning the refusal.
    if (current.suspendedAt) return new AttemptClosedError(409, "Test paused due to violations.");
    if ((current.visibility || resumeVersion !== undefined) && resumeVersion !== (current.resumeVersion ?? 0)) return new HttpError(409, "The examination session changed. Refresh before saving.");
    const saved = await saveLocked(fresh, current, raw, session);
    return saved.answers.filter(a => a.selected !== null).length;
  });
  if (result instanceof HttpError) throw result;
  return result;
}

/** How long the app may be out of the foreground before the attempt is ended. Short enough that switching to another app counts; long enough to ride out a system dialog. */
export const AWAY_LIMIT_MS = VISIBILITY_GRACE_MS;
const MAX_EVENTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The phone reports the app came back after being away ({ type: "away", awayMs },
 * plus the answers it holds). The event is recorded; if the app was away longer
 * than AWAY_LIMIT_MS the attempt is suspended with its saved answers and remaining time. The limit lives here, not in the app.
 * A phone that is offline, killed, or never reports can't be caught this way:
 * the attempt then simply runs to its original deadline.
 */
export async function recordEvent(test: TestRoomDoc, attempt: TestAttemptDoc, body: Record<string, unknown>): Promise<TestAttemptDoc> {
  const awayMs = body.awayMs;
  if (body.type !== "away" || typeof awayMs !== "number" || !Number.isFinite(awayMs) || awayMs < 0) throw new HttpError(400, "That isn't a valid event.");
  return withTestLock(test, async (fresh, session) => {
    const read = await TestAttempt.findById(attempt._id).session(session) as TestAttemptDoc;
    let current = await reconcileVisibilityLocked(fresh, read, session);
    if (current.submittedAt || current.suspendedAt) return current;
    if (expired(fresh, current)) return finalizeLocked(fresh, current, session, new Date(), !!fresh.manuallyEndedAt);
    // A late delivery from before teacher acknowledgement cannot suspend the
    // newly resumed session. New reports must carry its current generation.
    if ((body.resumeVersion ?? 0) !== (current.resumeVersion ?? 0)) return current;
    if (body.answers !== undefined) {
      try { current = await saveLocked(fresh, current, body.answers, session); }
      catch (error) { if (!(error instanceof HttpError && error.status < 500)) throw error; }
    }
    const at = new Date();
    const ended = awayMs > AWAY_LIMIT_MS;
    const remainingMs = Math.max(0, deadlineOf(fresh, current).getTime() - at.getTime());
    if (!remainingMs) return finalizeLocked(fresh, current, session, at);
    return await TestAttempt.findOneAndUpdate({ _id: current._id, submittedAt: null, suspendedAt: null, rev: (current.rev ?? 0) === 0 ? { $in: [0, null] } : current.rev }, {
      $push: { events: { $each: [{ type: "away", at, awayMs: Math.min(Math.round(awayMs), DAY_MS), ended }], $slice: -MAX_EVENTS } },
      $set: ended ? { suspendedAt: at, remainingMs, endedReason: "violation" } : {},
      $inc: { rev: 1 },
    }, { returnDocument: 'after', session }) as TestAttemptDoc;
  });
}

/** What the student sees of their attempt. */
export async function attemptOut(test: TestRoomDoc, attempt: TestAttemptDoc | null) {
  if (!attempt) return null;
  const reveal = !!attempt.submittedAt && await resultsReleased(test);
  return {
    id: String(attempt._id),
    revision: attempt.rev ?? 0,
    visibilityVerified: !!attempt.visibility && !attempt.visibility.interruption && Date.now() - attempt.visibility.lastSeenAt.getTime() <= VISIBILITY_GRACE_MS,
    suspendedAt: attempt.suspendedAt ?? null,
    remainingMs: attempt.remainingMs ?? 0,
    resumeVersion: attempt.resumeVersion ?? 0,
    state: attempt.suspendedAt ? ("suspended" as const) : attempt.submittedAt ? ("submitted" as const) : ("in-progress" as const),
    startedAt: attempt.startedAt,
    /** "violation" when the attempt was ended for leaving the app; the student can't restart it. */
    endedReason: attempt.endedReason ?? null,
    deadline: deadlineOf(test, attempt),
    /** The server's clock now, so the app can work out the time left without trusting the phone's. */
    serverTime: new Date(),
    answers: [...attempt.answers].sort((a, b) => a.index - b.index).map((a) => ({ index: a.index, selected: a.selected, correct: attempt.submittedAt && reveal ? a.correct : null })),
    // Until the test closes a submitted student only gets confirmation: the submission time, no marks.
    result: attempt.submittedAt && !reveal
      ? { submittedAt: attempt.submittedAt }
      : attempt.submittedAt
      ? {
          score: attempt.score,
          maxScore: attempt.maxScore,
          correct: attempt.correctCount,
          wrong: attempt.wrongCount,
          skipped: attempt.skippedCount,
          timeTakenSeconds: attempt.timeTakenSeconds,
          submittedAt: attempt.submittedAt,
        }
      : null,
  };
}

/** The test's questions for a student: answers and solutions only when `reveal` (see resultsReleased). */
export function questionsFor(test: TestRoomDoc, reveal: boolean) {
  return test.questions.map((q, index) => ({
    index,
    subject: q.subject,
    chapter: q.chapter,
    topic: q.topic,
    questionText: q.questionText,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    answerType: q.answerType,
    diagramUrls: q.diagramUrls,
    optionDiagramUrls: q.optionDiagramUrls,
    ...(reveal ? { correctAnswer: q.correctAnswer, explanation: q.explanation, explanationDiagramUrls: q.explanationDiagramUrls } : {}),
  }));
}
