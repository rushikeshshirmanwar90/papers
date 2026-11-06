import crypto from "node:crypto";
import { hashPassword, requireUser } from "@/lib/auth";
import { HttpError, route } from "@/lib/http";
import { sendMail, studentWelcomeEmail } from "@/lib/mailer";
import { batchNames, findMember, studentOut } from "@/lib/tuition";
import Tuition from "@/models/Tuition";

export const dynamic = "force-dynamic";

const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generatePassword(length = 14): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

/**
 * Resends the invitation email for an admin-created student who hasn't
 * activated their account yet. Generates a new temporary password,
 * invalidating the previous one, and sends a fresh welcome email.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");

  if ((student.accountStatus ?? "active") !== "invited") {
    throw new HttpError(409, "This student has already activated their account.");
  }

  const rawPassword = generatePassword();
  const tuition = await Tuition.findById(tuitionId).select("name").lean<{ name: string }>();
  const tuitionName = tuition?.name ?? "Your Tuition";

  const batchId = student.batchId ? String(student.batchId) : null;
  const names = await batchNames(tuitionId);
  const batchName = batchId ? names.get(batchId) : undefined;
  const batchStatus: "enrolled" | "approval" | "pending" = batchId ? "enrolled" : "pending";

  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendMail(studentWelcomeEmail({
      studentName: student.name,
      tuitionName,
      email: student.email,
      password: rawPassword,
      batchStatus,
      batchName,
    }));
    emailSent = true;
  } catch (error) {
    emailError = error instanceof Error ? error.message : "Couldn't send the email.";
    console.error("[students] resend invitation email failed:", error);
  }

  if (emailSent) {
    // Only update credentials after the email provider accepted the message.
    student.passwordHash = await hashPassword(rawPassword);
    student.tokenVersion += 1;
    student.mustChangePassword = true;
    student.invitationStatus = "sent";
    student.invitedAt = new Date();
    student.failedLogins = 0;
    student.lockedUntil = null;
    await student.save();
  } else {
    student.invitationStatus = "send_failed";
    await student.save();
  }

  return {
    student: studentOut(student, names),
    emailSent,
    emailError,
  };
});
