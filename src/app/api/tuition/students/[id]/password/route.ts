import { hashPassword, requireUser } from "@/lib/auth";
import { password, readJson, route } from "@/lib/http";
import { findMember } from "@/lib/tuition";

export const dynamic = "force-dynamic";

/** Sets a new password for a student who forgot theirs; signs them out everywhere. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");
  const body = await readJson(req);
  student.passwordHash = await hashPassword(password(body));
  student.tokenVersion += 1;
  student.failedLogins = 0;
  student.lockedUntil = null;
  await student.save();
  return { ok: true };
});
