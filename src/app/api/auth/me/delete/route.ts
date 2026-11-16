import bcrypt from "bcryptjs";
import { requireAccount } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import Attempt from "@/models/Attempt";
import DailyActivity from "@/models/DailyActivity";
import JoinRequest from "@/models/JoinRequest";
import PracticeAnswer from "@/models/PracticeAnswer";
import SelfAssessment from "@/models/SelfAssessment";
import StudentEngagement from "@/models/StudentEngagement";
import TestAttempt from "@/models/TestAttempt";
import User from "@/models/User";
import XpEvent from "@/models/XpEvent";

export const dynamic = "force-dynamic";

/**
 * Permanently deletes the signed-in account and every piece of data tied to it.
 *
 * Body: { password } — the user must confirm with their current password.
 *
 * What is removed per role:
 *   All roles  — User document, JoinRequests
 *   student    — Attempt, TestAttempt, SelfAssessment, PracticeAnswer,
 *                DailyActivity, StudentEngagement, XpEvent
 *   tuition    — blocked (a tuition's data belongs to its members;
 *                use the admin console to delete the whole tuition)
 */
export const DELETE = route(async (req) => {
  const { user, userId } = await requireAccount(req);

  // Tuition-owner accounts manage other people's data — they cannot
  // self-delete here. The admin console's delete-tuition flow handles that.
  if (user.role === "tuition") {
    throw new HttpError(
      403,
      "Tuition accounts cannot be deleted from here. Contact the platform admin to remove the whole tuition."
    );
  }

  // Require password confirmation so a hijacked session cannot silently wipe an account.
  const body = await readJson(req);
  const given = body.password;
  if (typeof given !== "string" || !given) {
    throw new HttpError(400, "Enter your password to confirm deletion.");
  }

  const userWithHash = await User.findById(userId).select("+passwordHash");
  if (!userWithHash) throw new HttpError(404, "Account not found.");

  const correct = await bcrypt.compare(given, userWithHash.passwordHash);
  if (!correct) throw new HttpError(400, "Wrong password.");

  const uid = userWithHash._id;

  // Delete all user-owned data in parallel, then the account itself.
  await Promise.all([
    JoinRequest.deleteMany({ userId: uid }),
    Attempt.deleteMany({ studentId: uid }),
    TestAttempt.deleteMany({ studentId: uid }),
    SelfAssessment.deleteMany({ studentId: uid }),
    PracticeAnswer.deleteMany({ studentId: uid }),
    DailyActivity.deleteMany({ studentId: uid }),
    StudentEngagement.deleteMany({ studentId: uid }),
    XpEvent.deleteMany({ studentId: uid }),
  ]);

  await User.deleteOne({ _id: uid });

  return { ok: true };
});
