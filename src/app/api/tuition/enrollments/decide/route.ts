import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { badRequest, isObjectId, oneOf, readJson, route } from "@/lib/http";
import { decideEnrollments, decideAdminEnrollment } from "@/lib/enrollment";

export const dynamic = "force-dynamic";

const MAX_AT_ONCE = 100;

/**
 * Approves or rejects students' requests to join a batch, one or many:
 * { ids: string[], action: "approve" | "reject" }. Tuition accounts only.
 *
 * For admin-created batch-assignment requests, send a single id with an
 * optional `batchId` to assign the batch during approval:
 * { ids: [id], action: "approve", batchId: "..." }.
 */
export const POST = route(async (req) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const action = oneOf(body, "action", ["approve", "reject", "dismiss"] as const, "approve, reject or dismiss");
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_AT_ONCE || !ids.every(isObjectId)) {
    throw badRequest(`Pick 1 to ${MAX_AT_ONCE} requests.`);
  }
  const batchId = isObjectId(body.batchId) ? body.batchId : undefined;

  // Single admin-created request with optional batch assignment.
  if (batchId || action === "dismiss") {
    if (ids.length !== 1) throw badRequest("Batch assignment or dismiss applies to one request at a time.");
    return decideAdminEnrollment(tuitionId, user.name, ids[0], action === "dismiss" ? "reject" : action, batchId);
  }

  return decideEnrollments(tuitionId, user.name, [...new Set(ids as string[])].map((id) => new Types.ObjectId(id)), action);
});
