import { publicUser, requireAccount } from "@/lib/auth";
import { checkCode } from "@/lib/email-codes";
import { readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Checks the code from the email: { code }. Marks the email verified. */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (!user.emailVerified) {
    await checkCode(user.email, "verify-email", (await readJson(req)).code);
    user.emailVerified = true;
    await user.save();
  }
  return { user: await publicUser(user) };
});
