import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { readSubject } from "@/lib/pyq";
import { createAssessment, detailOf, listFor, readSetup } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/** The student's self-assessments, newest first (?subject= for one subject). */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const value = req.nextUrl.searchParams.get("subject");
  const subject = value ? readSubject(value, session.user.track ?? "General") : null;
  return { assessments: await listFor(session, subject) };
});

/**
 * Makes a self-assessment from past-year questions:
 * { subject, scope: [{ standard, chapter, topics: [] }], count, mix, durationMinutes | null, negativeMarking }
 * (no topics: the whole chapter). It's ready to start; the questions come with Start.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "student");
  const setup = readSetup(await readJson(req), session.user.track ?? "General");
  return detailOf(await createAssessment(session, setup));
});
