import { requireAdmin } from "@/lib/admin";
import { isObjectId, notFound, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** Turns a user's login off or on: { active }. Turning it off logs them out everywhere. */
export const PATCH = route<{ params: { id: string } }>(async (req, { params }) => {
  await requireAdmin(req);
  if (!isObjectId(params.id)) throw notFound("This user");
  const user = await User.findById(params.id);
  if (!user) throw notFound("This user");
  const body = await readJson(req);
  if (body.active !== undefined) {
    user.active = body.active === true;
    if (!user.active) user.tokenVersion += 1;
  }
  await user.save();
  return { ok: true, active: user.active };
});
