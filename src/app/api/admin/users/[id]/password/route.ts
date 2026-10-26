import { requireAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth";
import { isObjectId, notFound, password, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** Sets a new password for anyone (and unlocks them): { password }. Logs them out everywhere. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  await requireAdmin(req);
  if (!isObjectId(params.id)) throw notFound("This user");
  const user = await User.findById(params.id);
  if (!user) throw notFound("This user");
  user.passwordHash = await hashPassword(password(await readJson(req)));
  user.tokenVersion += 1;
  user.failedLogins = 0;
  user.lockedUntil = null;
  await user.save();
  return { ok: true };
});
