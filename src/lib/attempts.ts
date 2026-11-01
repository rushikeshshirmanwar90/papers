import type { AnyBulkWriteOperation } from "mongoose";
import type { Session } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { cleanAnswer, scoreAnswers } from "@/lib/marking";
import { lastStartOf, statusOf } from "@/lib/tests";
import TestAttempt, { type TestAnswer, type TestAttemptDoc } from "@/models/TestAttempt";
import type { TestRoomDoc } from "@/models/TestRoom";

// A student's go at a test: started when they open it, saved as they answer,
// and scored when they submit or their time runs out. The server has no timers
// (it runs on Vercel), so an attempt whose time is up is scored by the next
// request that touches it.

const MAX_TRIES = 25;

/** Thrown when an attempt can no longer change: it was submitted, or its time is up. */
export class AttemptClosedError extends HttpError {}

/** When the attempt's time is up: its time limit, or the test closing, whichever is first. */
export function deadlineOf(test: TestRoomDoc, attempt: Pick<TestAttemptDoc, "startedAt">): Date {
  const byLimit = attempt.startedAt.getTime() + test.durationMinutes * 60 * 1000;
  return new Date(test.closesAt ? Math.min(byLimit, test.closesAt.getTime()) : byLimit);
}

/** Answers, correctness flags and solutions are released once the test has closed, not when one student submits. */
export const resultsReleased = (test: Pick<TestRoomDoc, "opensAt" | "closesAt">) => statusOf(test) === "closed";

const expired = (test: TestRoomDoc, attempt: Pick<TestAttemptDoc, "startedAt">, now = Date.now()) => now >= deadlineOf(test, attempt).getTime();

/**
 * Scores and closes the attempt with the answers it has. Safe to call from
 * several requests at once: only one write lands (submittedAt is still null),
 * and it only lands if no answer was saved since the answers were read (`rev`),
 * so every saved answer is counted. The `rev` check is never dropped: if saves
 * keep arriving it reads again, and after MAX_TRIES it gives up with a "try
 * again" error rather than score stale answers. Whoever loses a race to
 * finalize gets the stored result back.
 */
export async function finalize(test: TestRoomDoc, attempt: TestAttemptDoc, now = new Date()): Promise<TestAttemptDoc> {
  let current: TestAttemptDoc | null = attempt;
  for (let tries = 0; current && !current.submittedAt; tries++) {
    if (tries >= MAX_TRIES) throw new HttpError(409, "Your answers are still being saved. Try again in a moment.");
    const given = new Map(current.answers.map((a) => [a.index, a.selected]));
    const result = scoreAnswers(test.questions, given, test.marksPerQuestion, test.negativeMarks);
    const deadline = deadlineOf(test, current);
    const end = now > deadline ? deadline : now;
    const rev = current.rev ?? 0;
    const filter = { _id: current._id, submittedAt: null, rev: rev === 0 ? { $in: [0, null] } : rev };
    const done = (await TestAttempt.findOneAndUpdate(
      filter,
      {
        $set: {
          answers: result.answers,
          score: result.score,
          maxScore: result.maxScore,
          correctCount: result.correctCount,
          wrongCount: result.wrongCount,
          skippedCount: result.skippedCount,
          submittedAt: end,
          timeTakenSeconds: Math.max(0, Math.round((end.getTime() - current.startedAt.getTime()) / 1000)),
        },
      },
      { new: true }
    )) as TestAttemptDoc | null;
    if (done) return done;
    current = (await TestAttempt.findById(attempt._id)) as TestAttemptDoc | null;
  }
  return current ?? attempt;
}

/** The student's attempt at the test, finished first if its time ran out while they were away. */
export async function currentAttempt(test: TestRoomDoc, session: Session): Promise<TestAttemptDoc | null> {
  const attempt = (await TestAttempt.findOne({ testId: test._id, studentId: session.user._id })) as TestAttemptDoc | null;
  if (attempt && !attempt.submittedAt && expired(test, attempt)) return finalize(test, attempt);
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
    if (!expired(test, attempt)) continue;
    await finalize(test, attempt);
    n++;
  }
  return n;
}

export async function startAttempt(test: TestRoomDoc, session: Session): Promise<TestAttemptDoc> {
  const existing = await currentAttempt(test, session);
  if (existing) return existing;
  const status = statusOf(test);
  if (status === "scheduled") throw new HttpError(400, "This test hasn't opened yet.");
  if (status === "closed") throw new HttpError(400, "This test has closed.");
  // Starting late would cut the time limit short, so the last start is closing time minus the time limit.
  const lastStart = lastStartOf(test);
  if (lastStart && Date.now() > lastStart.getTime()) throw new HttpError(400, "It's too late to start this test: there isn't enough time left for the full time limit.");
  try {
    return (await TestAttempt.create({
      tuitionId: test.tuitionId,
      testId: test._id,
      batchId: test.batchId,
      studentId: session.user._id,
      startedAt: new Date(),
      answers: [],
      maxScore: test.questions.length * test.marksPerQuestion,
    })) as TestAttemptDoc;
  } catch (error) {
    // Opened twice at once (the unique testId + studentId index): use the one that got in first.
    if ((error as { code?: number }).code === 11000) return (await currentAttempt(test, session))!;
    throw error;
  }
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
 * Saves answers ({ index, selected }) into an attempt still in progress. Each
 * answer is written on its own, and only while the attempt is unsubmitted, so
 * repeating a save is harmless and a save can't undo a result just scored.
 * Returns how many questions are answered.
 */
export async function saveAnswers(test: TestRoomDoc, attempt: TestAttemptDoc, raw: unknown) {
  if (attempt.submittedAt) throw new AttemptClosedError(400, "You've already submitted this test.");
  if (expired(test, attempt)) throw new AttemptClosedError(400, "Time is up for this test.");
  const entries = readAnswers(test, raw);
  const open = { _id: attempt._id, submittedAt: null };
  // Per answer, exactly one of the two applies: change the entry if there is one, else add it.
  const ops = [...entries].flatMap(([index, selected]): AnyBulkWriteOperation<TestAttemptDoc>[] => [
    { updateOne: { filter: { ...open, "answers.index": index }, update: { $set: { "answers.$.selected": selected, "answers.$.correct": null }, $inc: { rev: 1 } } } },
    { updateOne: { filter: { ...open, "answers.index": { $ne: index } }, update: { $push: { answers: { index, selected, correct: null } }, $inc: { rev: 1 } } } },
  ]);
  if (ops.length) {
    const written = await TestAttempt.bulkWrite(ops, { ordered: true });
    // Nothing matched: it was scored between the check above and the write.
    if (written.matchedCount === 0) throw new AttemptClosedError(400, "You've already submitted this test.");
  }
  const saved = (await TestAttempt.findById(attempt._id).select("answers").lean<{ answers: TestAnswer[] }>())?.answers ?? [];
  return saved.filter((a) => a.selected !== null).length;
}

/** What the student sees of their attempt. */
export function attemptOut(test: TestRoomDoc, attempt: TestAttemptDoc | null) {
  if (!attempt) return null;
  return {
    state: attempt.submittedAt ? ("submitted" as const) : ("in-progress" as const),
    startedAt: attempt.startedAt,
    deadline: deadlineOf(test, attempt),
    /** The server's clock now, so the app can work out the time left without trusting the phone's. */
    serverTime: new Date(),
    answers: [...attempt.answers].sort((a, b) => a.index - b.index).map((a) => ({ index: a.index, selected: a.selected, correct: attempt.submittedAt && resultsReleased(test) ? a.correct : null })),
    // Until the test closes a submitted student only gets confirmation: the submission time, no marks.
    result: attempt.submittedAt && !resultsReleased(test)
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
