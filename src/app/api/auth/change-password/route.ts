import bcrypt from "bcryptjs";
import { hashPassword, publicUser, requireUser, signToken } from "@/lib/auth";
import { HttpError, password, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Changes the user's own password. Every other device is signed out; this one
 * gets a fresh token so it stays logged in.
 */
export const POST = route(async (req) => {
  const { userId } = await requireUser(req);
  const body = await readJson(req);
  const current = body.currentPassword;
  if (typeof current !== "string" || !current) throw new HttpError(400, "Enter your current password.");
  const next = password(body, "newPassword");

  const user = await User.findById(userId).select("+passwordHash");
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    throw new HttpError(400, "Your current password is wrong.");
  }
  if (current === next) throw new HttpError(400, "Choose a password different from the current one.");

  user.passwordHash = await hashPassword(next);
  user.tokenVersion += 1;
  await user.save();
  return { token: await signToken(user), user: await publicUser(user) };
});
