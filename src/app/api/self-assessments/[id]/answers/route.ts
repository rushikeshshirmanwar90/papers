import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { assessmentFor, saveAnswers } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/** Saves answers as the student goes: { answers: [{ index, selected }] }. */
export const PUT = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const body = await readJson(req);
  const a = await saveAnswers(await assessmentFor(session, params.id), body.answers);
  return { saved: a.answers.filter((x) => x.selected !== null).length };
});
