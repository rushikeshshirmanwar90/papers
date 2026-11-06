import { requireTestAccess } from '@/lib/test-access';
import { requireUser } from "@/lib/auth";
import { attemptOut, currentAttempt, questionsFor, recordEvent, resultsReleased } from "@/lib/attempts";
import { HttpError, readJson, route } from "@/lib/http";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * The phone reports the app was away during the test: { type: "away", awayMs,
 * answers?: [{ index, selected }] }. Away longer than the limit ends the attempt.
 * Returns the attempt as it now stands (already submitted attempts are returned unchanged).
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  await requireTestAccess(test, session);
  const attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  const done = await recordEvent(test, attempt, await readJson(req));
  return { attempt: await attemptOut(test, done), questions: questionsFor(test, (await resultsReleased(test))) };
});
