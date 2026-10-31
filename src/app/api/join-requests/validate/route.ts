import { requireAccount } from "@/lib/auth";
import { previewOf, resolveForPerson } from "@/lib/batch-invite";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Checks a joining code for someone who hasn't joined a tuition: { code }.
 * Answers with the institute and batch it leads to, so they can confirm. Wrong
 * codes are counted, and too many in a row lock code entry for a while.
 */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (user.tuitionId) throw new HttpError(400, "You're already part of a tuition.");
  if (!user.emailVerified) throw new HttpError(403, "Verify your email first.");
  const body = await readJson(req);
  return { preview: previewOf(await resolveForPerson(user._id, body.code)) };
});
