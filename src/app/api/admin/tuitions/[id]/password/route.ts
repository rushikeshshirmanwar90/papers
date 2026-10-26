import { requireAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth";
import { isObjectId, notFound, password, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** Sets a new password for the tuition's own login: { password }. Logs it out everywhere. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  await requireAdmin(req);
  if (!isObjectId(params.id)) throw notFound("This tuition");
  const owner = await User.findOne({ tuitionId: params.id, role: "tuition" });
  if (!owner) throw notFound("This tuition's login");
  owner.passwordHash = await hashPassword(password(await readJson(req)));
  owner.tokenVersion += 1;
  owner.failedLogins = 0;
  owner.lockedUntil = null;
  await owner.save();
  return { ok: true, email: owner.email };
});
