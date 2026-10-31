import { requireAccount } from "@/lib/auth";
import { myRequestOut, resolveForPerson } from "@/lib/batch-invite";
import { HttpError, readJson, route } from "@/lib/http";
import { pushToUsers } from "@/lib/push";
import JoinRequest, { type JoinRequestDoc } from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Asks a tuition to let the person in: { code }, either a batch's joining code
 * (they join that batch as a student) or the tuition's own join code.
 * One request at a time: asking again with the same code returns the pending
 * request; a different code cancels it and sends a new one.
 */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (user.tuitionId) throw new HttpError(400, "You're already part of a tuition.");
  if (!user.emailVerified) throw new HttpError(403, "Verify your email first.");
  const body = await readJson(req);
  const resolved = await resolveForPerson(user._id, body.code);
  const batchId = resolved.kind === "batch" ? resolved.batch._id : null;

  const same = (r: JoinRequestDoc | null) => !!r && String(r.tuitionId) === String(resolved.tuition._id) && String(r.batchId ?? "") === String(batchId ?? "");
  const pending = (await JoinRequest.findOne({ userId: user._id, status: "pending" })) as JoinRequestDoc | null;
  if (same(pending)) return { request: await myRequestOut(pending!) };

  await JoinRequest.updateMany({ userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  let request: JoinRequestDoc;
  try {
    request = (await JoinRequest.create({ userId: user._id, tuitionId: resolved.tuition._id, batchId })) as JoinRequestDoc;
  } catch (error) {
    // A second request of theirs got in first: it is the pending one.
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = (await JoinRequest.findOne({ userId: user._id, status: "pending" })) as JoinRequestDoc | null;
    if (!winner) throw error;
    return { request: await myRequestOut(winner) };
  }

  const owner = await User.findOne({ tuitionId: resolved.tuition._id, role: "tuition" }).select("_id").lean<{ _id: unknown }>();
  if (owner) {
    await pushToUsers([String(owner._id)], {
      title: "Someone wants to join",
      body:
        resolved.kind === "batch"
          ? `${user.name} asked to join ${resolved.batch.name}. Approve them under People › Students.`
          : `${user.name} asked to join ${resolved.tuition.name}. Accept them as a student or teacher on your Home tab.`,
      data: { tab: "home", kind: "join-request" },
    });
  }
  return { request: await myRequestOut(request) };
});
