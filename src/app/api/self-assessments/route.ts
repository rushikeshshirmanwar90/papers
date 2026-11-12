import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { readSubject } from "@/lib/pyq";
import { createAssessment, detailOf, listFor, readSetup } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/** The student's self-assessments, newest first (?subject= for one subject). */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const value = req.nextUrl.searchParams.get("subject");
  const subject = value ? readSubject(value, session.user) : null;
  return { assessments: await listFor(session, subject) };
});

/**
 * Makes a self-assessment from past-year questions:
 * { subjects: [Physics, …] (or subject), scope: [{ subject, standard, chapter, topics: [] }], count (5–150),
 *   mix, durationMinutes | null, negativeMarking, pool: pyqs | all | others (default pyqs) }
 * (no topics: the whole chapter). It's ready to start; the questions come with Start.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "student");
  const setup = readSetup(await readJson(req), session.user);
  return detailOf(await createAssessment(session, setup));
});
