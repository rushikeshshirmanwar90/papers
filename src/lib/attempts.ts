import type { Session } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { cleanAnswer, scoreAnswers } from "@/lib/marking";
import { statusOf } from "@/lib/tests";
import TestAttempt, { type TestAttemptDoc } from "@/models/TestAttempt";
import type { TestRoomDoc } from "@/models/TestRoom";

// A student's go at a test: started when they open it, saved as they answer,
// and scored when they submit or their time runs out.

/** Answers sent a little after the deadline still count (slow networks). */
const GRACE_MS = 60 * 1000;

/** When the attempt's time is up: its time limit, or the test closing, whichever is first. */
export function deadlineOf(test: TestRoomDoc, attempt: Pick<TestAttemptDoc, "startedAt">): Date {
  const byLimit = attempt.startedAt.getTime() + test.durationMinutes * 60 * 1000;
  return new Date(test.closesAt ? Math.min(byLimit, test.closesAt.getTime()) : byLimit);
}

/** Scores and closes the attempt with the answers it has. */
export async function finalize(test: TestRoomDoc, attempt: TestAttemptDoc, now = new Date()) {
  if (attempt.submittedAt) return attempt;
  const given = new Map(attempt.answers.map((a) => [a.index, a.selected]));
  const result = scoreAnswers(test.questions, given, test.marksPerQuestion, test.negativeMarks);
  const deadline = deadlineOf(test, attempt);
  const end = now > deadline ? deadline : now;
  attempt.set({
    answers: result.answers,
    score: result.score,
    maxScore: result.maxScore,
    correctCount: result.correctCount,
    wrongCount: result.wrongCount,
    skippedCount: result.skippedCount,
    submittedAt: end,
    timeTakenSeconds: Math.max(0, Math.round((end.getTime() - attempt.startedAt.getTime()) / 1000)),
  });
  await attempt.save();
  return attempt;
}

/** The student's attempt at the test, finished first if its time ran out while they were away. */
export async function currentAttempt(test: TestRoomDoc, session: Session): Promise<TestAttemptDoc | null> {
  const attempt = (await TestAttempt.findOne({ testId: test._id, studentId: session.user._id })) as TestAttemptDoc | null;
  if (attempt && !attempt.submittedAt && Date.now() > deadlineOf(test, attempt).getTime() + GRACE_MS) {
    return finalize(test, attempt);
  }
  return attempt;
}

export async function startAttempt(test: TestRoomDoc, session: Session): Promise<TestAttemptDoc> {
  const existing = await currentAttempt(test, session);
  if (existing) return existing;
  const status = statusOf(test);
  if (status === "scheduled") throw new HttpError(400, "This test hasn't opened yet.");
  if (status === "closed") throw new HttpError(400, "This test has closed.");
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
    // Opened twice at once: use the one that got in first.
    if ((error as { code?: number }).code === 11000) return (await currentAttempt(test, session))!;
    throw error;
  }
}

/** Saves answers ({ index, selected }) into an attempt still in progress. */
export function mergeAnswers(test: TestRoomDoc, attempt: TestAttemptDoc, raw: unknown) {
  if (attempt.submittedAt) throw new HttpError(400, "You've already submitted this test.");
  if (Date.now() > deadlineOf(test, attempt).getTime() + GRACE_MS) throw new HttpError(400, "Time is up for this test.");
  if (!Array.isArray(raw)) throw new HttpError(400, "Send the answers as a list.");
  const byIndex = new Map(attempt.answers.map((a) => [a.index, a.selected]));
  for (const entry of raw.slice(0, test.questions.length)) {
    const { index, selected } = (entry ?? {}) as { index?: unknown; selected?: unknown };
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= test.questions.length) continue;
    byIndex.set(index as number, cleanAnswer(test.questions[index as number], selected));
  }
  attempt.answers = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, selected]) => ({ index, selected, correct: null }));
}

/** What the student sees of their attempt. */
export function attemptOut(test: TestRoomDoc, attempt: TestAttemptDoc | null) {
  if (!attempt) return null;
  return {
    state: attempt.submittedAt ? ("submitted" as const) : ("in-progress" as const),
    startedAt: attempt.startedAt,
    deadline: deadlineOf(test, attempt),
    answers: attempt.answers.map((a) => ({ index: a.index, selected: a.selected, correct: attempt.submittedAt ? a.correct : null })),
    result: attempt.submittedAt
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

/** The test's questions for a student: answers and solutions only once they've submitted (or it closed). */
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
