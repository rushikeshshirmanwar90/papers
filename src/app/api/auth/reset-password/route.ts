import { hashPassword } from "@/lib/auth";
import { checkCode } from "@/lib/email-codes";
import { HttpError, email, password, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Sets a new password with the emailed code: { email, code, newPassword }.
 * Logs out every device; the email counts as verified.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const address = email(body);
  const next = password(body, "newPassword");
  await checkCode(address, "reset-password", body.code);
  const user = await User.findOne({ email: address });
  if (!user || !user.active) throw new HttpError(400, "This code has expired. Ask for a new one.");
  user.passwordHash = await hashPassword(next);
  user.tokenVersion += 1;
  user.failedLogins = 0;
  user.lockedUntil = null;
  user.emailVerified = true;
  await user.save();
  return { ok: true };
});
