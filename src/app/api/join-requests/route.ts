import { requireAccount } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { tuitionByCode } from "@/lib/join-code";
import { pushToUsers } from "@/lib/push";
import JoinRequest from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Asks a tuition to let the person in: { code } (the tuition's join code).
 * One request at a time: sending a new one cancels a pending one.
 */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (user.tuitionId) throw new HttpError(400, "You're already part of a tuition.");
  if (!user.emailVerified) throw new HttpError(403, "Verify your email first.");
  const body = await readJson(req);
  const tuition = await tuitionByCode(body.code);
  if (!tuition) {
    // Slows down guessing codes.
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(404, "That code doesn't match any tuition. Check it with your tuition.");
  }
  await JoinRequest.updateMany({ userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  await JoinRequest.create({ userId: user._id, tuitionId: tuition._id });

  const owner = await User.findOne({ tuitionId: tuition._id, role: "tuition" }).select("_id").lean<{ _id: unknown }>();
  if (owner) {
    await pushToUsers([String(owner._id)], {
      title: "Someone wants to join",
      body: `${user.name} asked to join ${tuition.name}. Accept them as a student or teacher on your Home tab.`,
      data: { tab: "home", kind: "join-request" },
    });
  }
  return { request: { status: "pending", tuition: { name: tuition.name, address: tuition.address } } };
});
