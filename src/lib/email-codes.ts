import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { HttpError } from "@/lib/http";
import { codeEmail, sendMail } from "@/lib/mailer";
import EmailCode, { type CodePurpose, type EmailCodeDoc } from "@/models/EmailCode";

// One-time 6-digit codes sent by email: made and checked on the server (the
// app never knows the code), stored only as a keyed hash, valid for 10
// minutes, 5 wrong tries, at most one email a minute and 5 an hour.

const VALID_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_S = 60;
const MAX_PER_HOUR = 5;

function hash(email: string, purpose: CodePurpose, code: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(503, "Logins aren't set up on the server yet.");
  return createHmac("sha256", secret).update(`${purpose}:${email}:${code}`).digest("hex");
}

const COPY: Record<CodePurpose, { subject: string; title: string; intro: string }> = {
  "verify-email": {
    subject: "Your email verification code",
    title: "Verify your email",
    intro: "Enter this code in the app to verify your email address.",
  },
  "reset-password": {
    subject: "Your password reset code",
    title: "Reset your password",
    intro: "Someone (hopefully you) asked to reset your password. Enter this code in the app to choose a new one.",
  },
};

/**
 * Emails a new code (replacing older ones for the same purpose). Returns how
 * many seconds until another may be sent.
 */
export async function sendCode(email: string, name: string, purpose: CodePurpose): Promise<{ resendAfter: number }> {
  const address = email.toLowerCase();
  const latest = (await EmailCode.findOne({ email: address, purpose }).sort({ createdAt: -1 })) as EmailCodeDoc | null;
  if (latest) {
    const waited = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (waited < RESEND_AFTER_S) {
      const left = Math.ceil(RESEND_AFTER_S - waited);
      throw new HttpError(429, `Wait ${left} seconds before asking for another code.`);
    }
  }
  const lastHour = await EmailCode.countDocuments({ email: address, purpose, createdAt: { $gte: new Date(Date.now() - 3600_000) } });
  if (lastHour >= MAX_PER_HOUR) throw new HttpError(429, "Too many codes asked for. Try again in an hour.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Older codes stop working; this one is the only valid code.
  await EmailCode.updateMany({ email: address, purpose }, { attempts: MAX_ATTEMPTS });
  const entry = await EmailCode.create({
    email: address,
    purpose,
    codeHash: hash(address, purpose, code),
    expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000),
  });

  const copy = COPY[purpose];
  const { html, text } = codeEmail({ name, title: copy.title, intro: copy.intro, code, minutes: VALID_MINUTES });
  try {
    await sendMail({ to: address, subject: copy.subject, html, text });
  } catch (error) {
    // Not sent: don't count it, so they can try again at once.
    await entry.deleteOne();
    throw error;
  }
  return { resendAfter: RESEND_AFTER_S };
}

/** Checks a code; throws 400 when it's wrong, used up or expired. Used once. */
export async function checkCode(email: string, purpose: CodePurpose, given: unknown) {
  const address = email.toLowerCase();
  const code = typeof given === "string" ? given.replace(/\D/g, "") : "";
  if (code.length !== 6) throw new HttpError(400, "Enter the 6-digit code from the email.");
  const entry = (await EmailCode.findOne({ email: address, purpose, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 })) as EmailCodeDoc | null;
  if (!entry || entry.attempts >= MAX_ATTEMPTS) throw new HttpError(400, "This code has expired. Ask for a new one.");

  const ok = timingSafeEqual(Buffer.from(entry.codeHash, "hex"), Buffer.from(hash(address, purpose, code), "hex"));
  if (!ok) {
    entry.attempts += 1;
    await entry.save();
    const left = MAX_ATTEMPTS - entry.attempts;
    throw new HttpError(400, left > 0 ? `That code is wrong. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Ask for a new code.");
  }
  await EmailCode.deleteMany({ email: address, purpose });
}
