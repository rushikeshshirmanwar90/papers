import { requireUser } from "@/lib/auth";
import { oneOf, route } from "@/lib/http";
import { STANDARDS, SUBJECTS } from "@/lib/school";
import { syllabusFor } from "@/lib/syllabus";

export const dynamic = "force-dynamic";

/**
 * A subject's chapters and their topics, from the question bank.
 * ?subject=Physics[&standard=11th] — both classes when no standard is given.
 */
export const GET = route(async (req) => {
  await requireUser(req);
  const params = req.nextUrl.searchParams;
  const subject = oneOf({ subject: params.get("subject") }, "subject", SUBJECTS, "a subject");
  const standard = params.get("standard");
  const standards = standard ? [oneOf({ standard }, "standard", STANDARDS, "a class")] : [...STANDARDS];
  return { subject, chapters: await syllabusFor(subject, standards) };
});
