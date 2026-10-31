import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { assessmentFor, mergeAnswers } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/** Saves answers as the student goes: { answers: [{ index, selected }] }. */
export const PUT = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const a = await assessmentFor(session, params.id);
  mergeAnswers(a, (await readJson(req)).answers);
  await a.save();
  return { saved: a.answers.filter((x) => x.selected !== null).length };
});
