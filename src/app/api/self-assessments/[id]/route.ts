import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assessmentFor, detailOf } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

/** One of the student's self-assessments: questions once started, answers, solutions and the report once submitted. */
export const GET = route<Context>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  return detailOf(await assessmentFor(session, params.id));
});

/** Deletes it. Answers already counted as practice stay. */
export const DELETE = route<Context>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  const a = await assessmentFor(session, params.id);
  await a.deleteOne();
  return { ok: true };
});
