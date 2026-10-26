import { requireAccount } from "@/lib/auth";
import { sendCode } from "@/lib/email-codes";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Emails (another) verification code to the signed-in user. */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (user.emailVerified) return { verified: true, resendAfter: 0 };
  const { resendAfter } = await sendCode(user.email, user.name, "verify-email");
  return { verified: false, resendAfter };
});
