import { requireUser } from "@/lib/auth";
import { studentOf } from "@/lib/engagement/award";
import { selfAssessmentEngagement } from "@/lib/engagement/rules";
import { readJson, route } from "@/lib/http";
import { assessmentFor, detailOf, finalize } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/**
 * Submits it, with any last answers ({ answers?: [{ index, selected }] }),
 * and returns the result: answers, solutions and the topic-by-topic report.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  let a = await assessmentFor(session, params.id);
  if (!a.submittedAt) {
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    // Any last answers go in first; finalize retries if an autosave lands at the same moment.
    a = await finalize(a, new Date(), body.answers);
  }
  // After the save; never throws (null when gamification fails).
  const engagement = await selfAssessmentEngagement(studentOf(session), a);
  return { ...detailOf(a), engagement };
});
