import { requireTestAccess } from '@/lib/test-access';
import { requireUser } from "@/lib/auth";
import { attemptOut, currentAttempt, questionsFor, resultsReleased, submitAnswers } from "@/lib/attempts";
import { HttpError, readJson, route } from "@/lib/http";
import { completionReleased } from '@/lib/test-completion';
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * Submits the test, with any last answers ({ answers?: [{ index, selected }] }),
 * and returns the result. Answers, correctness and solutions come with it only
 * once the test has closed. Submitting twice returns the first result.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  await requireTestAccess(test, session);
  let attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  if (attempt.suspendedAt) throw new HttpError(409, "Test paused due to violations. Waiting for teacher decision.");
  if (!attempt.submittedAt) {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    attempt = await submitAnswers(test, attempt, body);
  }
  // Reconcile expired attempts; suspensions still await a teacher decision.
  if (test.closesAt.getTime() <= Date.now()) await completionReleased(test);
  return { attempt: await attemptOut(test, attempt), questions: questionsFor(test, (await resultsReleased(test))) };
});
