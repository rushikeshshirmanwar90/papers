import { requireUser } from "@/lib/auth";
import { badRequest, HttpError, oneOf, readJson, route } from "@/lib/http";
import { changeInvite, inviteOf, inviteOut, inviteProblem, readExpiryDays } from "@/lib/batch-invite";
import { findBatch } from "@/lib/tuition";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** The batch's joining code (made on first use) with its status and expiry. Tuition accounts only. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  const problem = inviteProblem(batch);
  if (problem) throw badRequest(problem);
  return { invite: await inviteOut(await inviteOf(batch, user._id), batch) };
});

/**
 * { action: "regenerate" | "revoke" | "extend", expiresInDays? }.
 * Regenerating stops the old code at once; revoking turns joining off.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  const body = await readJson(req);
  const action = oneOf(body, "action", ["regenerate", "revoke", "extend"] as const, "an action");
  if (action !== "revoke") {
    const problem = inviteProblem(batch);
    if (problem) throw new HttpError(400, problem);
  }
  const invite = await changeInvite(batch, user._id, action, action === "revoke" ? null : readExpiryDays(body));
  return { invite: await inviteOut(invite, batch) };
});
