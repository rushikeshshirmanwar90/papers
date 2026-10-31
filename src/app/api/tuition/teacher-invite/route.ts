import { requireUser } from "@/lib/auth";
import { changeTeacherInvite, readExpiryDays, teacherInviteOf, teacherInviteOut } from "@/lib/batch-invite";
import { oneOf, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The institute's teacher joining code (made on first use) with its status and expiry. Tuition accounts only. */
export const GET = route(async (req) => {
  const { user } = await requireUser(req, "tuition");
  return { invite: await teacherInviteOut(await teacherInviteOf(user.tuitionId!, user._id)) };
});

/**
 * { action: "regenerate" | "revoke" | "extend", expiresInDays? }.
 * Regenerating stops the old code at once; revoking turns joining off.
 */
export const POST = route(async (req) => {
  const { user } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const action = oneOf(body, "action", ["regenerate", "revoke", "extend"] as const, "an action");
  const invite = await changeTeacherInvite(user.tuitionId!, user._id, action, action === "revoke" ? null : readExpiryDays(body));
  return { invite: await teacherInviteOut(invite) };
});
