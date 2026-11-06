import { requireUser } from "@/lib/auth";
import { HttpError, route } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Quick check whether an email is available for a new student account.
 * Returns { available: false, reason } when the email is already taken.
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const raw = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!raw) throw new HttpError(400, "Provide an email to check.");

  const existing = await User.findOne({ email: raw })
    .select("role tuitionId accountStatus")
    .lean<{ _id: unknown; role: string | null; tuitionId: unknown; accountStatus?: string } | null>();

  if (!existing) return { available: true };

  const role = existing.role ?? "user";
  const sameInstitute = existing.tuitionId && String(existing.tuitionId) === tuitionId;
  const isInvited = existing.accountStatus === "invited";

  let reason: string;
  let accountStatus: string | null = null;
  let studentId: string | null = null;

  if (role === "student" && sameInstitute && isInvited) {
    reason = "This student has already been invited and has not activated their account yet.";
    accountStatus = "invited";
    studentId = String(existing._id);
  } else if (role === "student" && sameInstitute) {
    reason = "This student already has an active account.";
    accountStatus = "active";
    studentId = String(existing._id);
  } else if (role === "student") {
    reason = "This email is already registered as a student at another institute.";
  } else if (role === "teacher") {
    reason = "This email is already registered as a teacher.";
  } else {
    reason = "An account with this email already exists.";
  }

  return { available: false, reason, accountStatus, studentId };
});
