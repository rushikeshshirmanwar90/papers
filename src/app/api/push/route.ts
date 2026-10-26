import { requireAccount } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { isPushToken } from "@/lib/push";
import User from "@/models/User";

export const dynamic = "force-dynamic";

const MAX_DEVICES = 5;

/** Registers this phone for notifications: { token: "ExponentPushToken[…]", platform }. */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  const body = await readJson(req);
  if (!isPushToken(body.token)) throw new HttpError(400, "That isn't a push token.");
  const platform = typeof body.platform === "string" ? body.platform.slice(0, 10) : "";
  // A phone belongs to one login at a time.
  await User.updateMany({ "pushTokens.token": body.token }, { $pull: { pushTokens: { token: body.token } } });
  const me = await User.findById(user._id).select("+pushTokens");
  if (!me) throw new HttpError(401, "Log in again.");
  me.pushTokens = [...me.pushTokens, { token: body.token, platform, updatedAt: new Date() }].slice(-MAX_DEVICES);
  await me.save();
  return { ok: true };
});

/** Stops notifications to this phone (on log out): { token }. */
export const DELETE = route(async (req) => {
  const { user } = await requireAccount(req);
  const body = await readJson(req);
  if (isPushToken(body.token)) await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { token: body.token } } });
  return { ok: true };
});
