import { requireAccount } from "@/lib/auth";
import { myRequestOut } from "@/lib/batch-invite";
import { route } from "@/lib/http";
import JoinRequest, { type JoinRequestDoc } from "@/models/JoinRequest";

export const dynamic = "force-dynamic";

/** The person's latest join request and its state, with the tuition's name (and the batch, for a batch's code). */
export const GET = route(async (req) => {
  const { user } = await requireAccount(req);
  const latest = (await JoinRequest.findOne({ userId: user._id, status: { $ne: "cancelled" } }).sort({ createdAt: -1 })) as JoinRequestDoc | null;
  return { request: latest ? await myRequestOut(latest) : null };
});

/** Cancels the person's pending request (e.g. sent to the wrong tuition). */
export const DELETE = route(async (req) => {
  const { user } = await requireAccount(req);
  await JoinRequest.updateMany({ userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  return { ok: true };
});
