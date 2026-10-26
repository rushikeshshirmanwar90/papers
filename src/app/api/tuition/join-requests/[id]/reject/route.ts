import { requireUser } from "@/lib/auth";
import { isObjectId, notFound, route } from "@/lib/http";
import JoinRequest from "@/models/JoinRequest";

export const dynamic = "force-dynamic";

/** Turns the request down; the person can ask again (or ask another tuition). */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  if (!isObjectId(params.id)) throw notFound("This request");
  const request = await JoinRequest.findOne({ _id: params.id, tuitionId, status: "pending" });
  if (!request) throw notFound("This request");
  request.status = "rejected";
  request.decidedAt = new Date();
  await request.save();
  return { ok: true };
});
