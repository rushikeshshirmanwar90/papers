import { requireUser } from "@/lib/auth";
import { decideTeacher } from "@/lib/enrollment";
import { isObjectId, notFound, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Approves a pending teacher request. The person becomes a teacher of this
 * tuition with the subjects they asked with; no batch is assigned. Student
 * (batch) requests are decided through /api/tuition/enrollments/decide.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  if (!isObjectId(params.id)) throw notFound("This request");
  await decideTeacher(tuitionId, user.name, params.id, "approve");
  return { ok: true };
});
