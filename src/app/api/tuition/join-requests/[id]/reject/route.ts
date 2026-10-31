import { requireUser } from "@/lib/auth";
import { decideTeacher } from "@/lib/enrollment";
import { isObjectId, notFound, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Turns a teacher request down; the person can ask again (or ask another tuition). */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  if (!isObjectId(params.id)) throw notFound("This request");
  await decideTeacher(tuitionId, user.name, params.id, "reject");
  return { ok: true };
});
