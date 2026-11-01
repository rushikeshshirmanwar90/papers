import { requireUser } from "@/lib/auth";
import { AttemptClosedError, attemptOut, currentAttempt, finalize, questionsFor, resultsReleased, saveAnswers } from "@/lib/attempts";
import { HttpError, readJson, route } from "@/lib/http";
import { testFor } from "@/lib/tests";
import TestAttempt, { type TestAttemptDoc } from "@/models/TestAttempt";

export const dynamic = "force-dynamic";

/**
 * Submits the test, with any last answers ({ answers?: [{ index, selected }] }),
 * and returns the result. Answers, correctness and solutions come with it only
 * once the test has closed. Submitting twice returns the first result.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  let attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  if (!attempt.submittedAt) {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    if (body.answers !== undefined) {
      try {
        await saveAnswers(test, attempt, body.answers);
      } catch (error) {
        // Too late to change answers: submit what was saved. Invalid answers are still refused.
        if (!(error instanceof AttemptClosedError)) throw error;
      }
    }
    // Read again so the answers just saved are the ones scored.
    attempt = await finalize(test, ((await TestAttempt.findById(attempt._id)) as TestAttemptDoc | null) ?? attempt);
  }
  return { attempt: attemptOut(test, attempt), questions: questionsFor(test, resultsReleased(test)) };
});
