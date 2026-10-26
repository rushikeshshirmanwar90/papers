import { requireAccount } from "@/lib/auth";
import { route } from "@/lib/http";
import JoinRequest from "@/models/JoinRequest";
import Tuition from "@/models/Tuition";

export const dynamic = "force-dynamic";

/** The person's latest join request and its state, with the tuition's name. */
export const GET = route(async (req) => {
  const { user } = await requireAccount(req);
  const latest = await JoinRequest.findOne({ userId: user._id, status: { $ne: "cancelled" } })
    .sort({ createdAt: -1 })
    .lean<{ _id: unknown; tuitionId: unknown; status: string; acceptedAs: string | null; createdAt: Date; decidedAt: Date | null }>();
  if (!latest) return { request: null };
  const tuition = await Tuition.findById(latest.tuitionId).select("name address").lean<{ name: string; address: string }>();
  return {
    request: {
      id: String(latest._id),
      status: latest.status,
      acceptedAs: latest.acceptedAs,
      createdAt: latest.createdAt,
      decidedAt: latest.decidedAt,
      tuition: { name: tuition?.name ?? "", address: tuition?.address ?? "" },
    },
  };
});

/** Cancels the person's pending request (e.g. sent to the wrong tuition). */
export const DELETE = route(async (req) => {
  const { user } = await requireAccount(req);
  await JoinRequest.updateMany({ userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  return { ok: true };
});
