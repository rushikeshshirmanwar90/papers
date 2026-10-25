import { requireUser } from "@/lib/auth";
import { attemptOut, questionsFor, startAttempt } from "@/lib/attempts";
import { route } from "@/lib/http";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/** A student starts the test (or carries on with it): their clock starts now. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  const attempt = await startAttempt(test, session);
  return { attempt: attemptOut(test, attempt), questions: questionsFor(test, !!attempt.submittedAt) };
});
