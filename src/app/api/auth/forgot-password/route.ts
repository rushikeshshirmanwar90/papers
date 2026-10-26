import { sendCode } from "@/lib/email-codes";
import { email, readJson, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Emails a password reset code: { email }. Answers the same whether or not
 * the email has an account, so it can't be used to find out who's registered.
 */
export const POST = route(async (req) => {
  const address = email(await readJson(req));
  const user = await User.findOne({ email: address, active: true }).select("name email").lean<{ name: string; email: string }>();
  if (user) {
    try {
      await sendCode(user.email, user.name, "reset-password");
    } catch (error) {
      // A too-soon resend looks like success; a mail failure is worth saying.
      if ((error as { status?: number }).status === 502 || (error as { status?: number }).status === 503) throw error;
    }
  }
  return { ok: true, message: "If that email has an account, a code is on its way." };
});
