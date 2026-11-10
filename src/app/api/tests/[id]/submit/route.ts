import { requireTestAccess } from '@/lib/test-access';
import { requireUser } from "@/lib/auth";
import { AttemptClosedError, attemptOut, currentAttempt, finalize, questionsFor, resultsReleased, saveAnswers } from "@/lib/attempts";
import { testEngagement } from "@/lib/engagement/rules";
import { HttpError, readJson, route } from "@/lib/http";
import { completionReleased } from '@/lib/test-completion';
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
  await requireTestAccess(test, session);
  let attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  if (attempt.suspendedAt) throw new HttpError(409, "Test paused due to violations. Waiting for teacher decision.");
  if (!attempt.submittedAt) {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    if ((attempt.visibility || body.resumeVersion !== undefined) && body.resumeVersion !== (attempt.resumeVersion ?? 0)) throw new HttpError(409, "The examination session changed. Refresh before submitting.");
    if (body.answers !== undefined) {
      try {
        await saveAnswers(test, attempt, body.answers, body.resumeVersion);
      } catch (error) {
        // Too late to change answers: submit what was saved. Invalid answers are still refused.
        if (!(error instanceof AttemptClosedError)) throw error;
      }
    }
    // Read again so the answers just saved are the ones scored.
    attempt = await finalize(test, ((await TestAttempt.findById(attempt._id)) as TestAttemptDoc | null) ?? attempt, new Date(), false, typeof body.resumeVersion === "number" ? body.resumeVersion : attempt.resumeVersion ?? 0);
  }
  // The last extended student finishing completes the test: settle suspensions now.
  if (test.closesAt.getTime() <= Date.now()) await completionReleased(test);
  // Outside every test lock. finalize() has already awarded; this repeat is idempotent and
  // returns the student's progress (null when gamification fails).
  const engagement = await testEngagement(attempt);
  return { attempt: await attemptOut(test, attempt), questions: questionsFor(test, (await resultsReleased(test))), engagement };
});
