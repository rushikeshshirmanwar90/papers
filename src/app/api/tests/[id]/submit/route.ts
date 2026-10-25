import { requireUser } from "@/lib/auth";
import { attemptOut, currentAttempt, finalize, mergeAnswers, questionsFor } from "@/lib/attempts";
import { HttpError, readJson, route } from "@/lib/http";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * Submits the test, with any last answers ({ answers?: [{ index, selected }] }),
 * and returns the result with the answers and solutions.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  const attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  if (!attempt.submittedAt) {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    // Late answers (after time is up) are ignored; the saved ones count.
    if (body.answers !== undefined) {
      try {
        mergeAnswers(test, attempt, body.answers);
      } catch {
        // Too late to change answers; submit what was saved.
      }
    }
    await finalize(test, attempt);
  }
  return { attempt: attemptOut(test, attempt), questions: questionsFor(test, true) };
});
