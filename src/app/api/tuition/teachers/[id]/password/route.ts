import { hashPassword, requireUser } from "@/lib/auth";
import { password, readJson, route } from "@/lib/http";
import { findMember } from "@/lib/tuition";

export const dynamic = "force-dynamic";

/** Sets a new password for a teacher who forgot theirs; signs them out everywhere. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const teacher = await findMember(tuitionId, params.id, "teacher");
  const body = await readJson(req);
  teacher.passwordHash = await hashPassword(password(body));
  teacher.tokenVersion += 1;
  teacher.failedLogins = 0;
  teacher.lockedUntil = null;
  await teacher.save();
  return { ok: true };
});
