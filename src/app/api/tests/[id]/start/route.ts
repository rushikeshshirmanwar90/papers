import { requireUser } from "@/lib/auth";
import { attemptOut, questionsFor, resultsReleased, startAttempt } from "@/lib/attempts";
import { readJson, route } from "@/lib/http";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/** A student starts the test (or carries on with it): their clock starts now. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  const body = await readJson(req).catch(() => ({} as Record<string, unknown>));
  const attempt = await startAttempt(test, session, body.visibility === true, body.answerVersions === true);
  return { attempt: await attemptOut(test, attempt), questions: questionsFor(test, (await resultsReleased(test))) };
});
