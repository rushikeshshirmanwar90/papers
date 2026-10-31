import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { badRequest, isObjectId, oneOf, readJson, route } from "@/lib/http";
import { decideEnrollments } from "@/lib/enrollment";

export const dynamic = "force-dynamic";

const MAX_AT_ONCE = 100;

/**
 * Approves or rejects students' requests to join a batch, one or many:
 * { ids: string[], action: "approve" | "reject" }. Tuition accounts only.
 * Every id must be a pending request of this tuition's own: any other id
 * (another tuition's, already decided, not a batch request) is refused and
 * nothing is changed. People who can't be approved (e.g. they joined
 * elsewhere meanwhile) come back in `failed`; the rest still go through.
 */
export const POST = route(async (req) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const action = oneOf(body, "action", ["approve", "reject"] as const, "approve or reject");
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_AT_ONCE || !ids.every(isObjectId)) {
    throw badRequest(`Pick 1 to ${MAX_AT_ONCE} requests.`);
  }
  return decideEnrollments(tuitionId, user.name, [...new Set(ids as string[])].map((id) => new Types.ObjectId(id)), action);
});
