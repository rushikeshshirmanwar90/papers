import { requireUser } from "@/lib/auth";
import { currentAttempt, saveAnswers } from "@/lib/attempts";
import { HttpError, readJson, route } from "@/lib/http";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/** Saves answers as the student goes: { answers: [{ index, selected }] }. */
export const PUT = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const { test } = await testFor(session, params.id);
  const attempt = await currentAttempt(test, session);
  if (!attempt) throw new HttpError(400, "Start the test first.");
  const body = await readJson(req);
  return { saved: await saveAnswers(test, attempt, body.answers) };
});
