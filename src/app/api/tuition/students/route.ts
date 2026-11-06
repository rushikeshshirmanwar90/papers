import { hashPassword, requireUser } from "@/lib/auth";
import { email, isObjectId, password, readJson, route, text, oneOf } from "@/lib/http";
import { PROGRAM_INFO } from "@/lib/school";
import { sendMail, studentWelcomeEmail } from "@/lib/mailer";
import { batchNames, mustFit, readNewStudent, readStudentBatch, studentOut } from "@/lib/tuition";
import User, { type UserDoc } from "@/models/User";
import JoinRequest from "@/models/JoinRequest";
import Tuition from "@/models/Tuition";

export const dynamic = "force-dynamic";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The tuition's students, by name. ?batchId= narrows to one batch
 * (?batchId=none: students without one); ?q= searches names and emails.
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const params = req.nextUrl.searchParams;
  const filter: Record<string, unknown> = { tuitionId, role: "student" };
  const batchId = params.get("batchId");
  if (batchId === "none") filter.batchId = null;
  else if (isObjectId(batchId)) filter.batchId = batchId;
  const accountStatus = params.get("accountStatus");
  if (accountStatus === "invited") filter.accountStatus = "invited";
  else if (accountStatus === "active") filter.$or = [{ accountStatus: "active" }, { accountStatus: { $exists: false } }];
  const q = params.get("q")?.trim();
  if (q) {
    const re = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    const textMatch = [{ name: re }, { email: re }];
    // Combine with existing $or (accountStatus) if needed.
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: textMatch }];
      delete filter.$or;
    } else {
      filter.$or = textMatch;
    }
  }
  const [students, names] = await Promise.all([
    User.find(filter).sort({ name: 1 }).limit(500) as Promise<UserDoc[]>,
    batchNames(tuitionId),
  ]);
  return { students: students.map((s) => studentOut(s, names)) };
});

const ENROLLMENT_METHODS = ["enroll_immediately", "require_approval"] as const;
type EnrollmentMethod = (typeof ENROLLMENT_METHODS)[number];

/**
 * Creates a student account with an initial password.
 *
 * Fields: name, email, password, program, standard, phone?, parentPhone?,
 *         batchId?, enrollmentMethod? ("enroll_immediately" | "require_approval").
 *
 * Three enrollment paths:
 * 1. Batch + enroll_immediately → student is enrolled in the batch at once.
 * 2. Batch + require_approval → a pending enrollment request is created.
 * 3. No batch → a pending batch-assignment request is created.
 *
 * In all cases a welcome email is sent with the initial password.
 * The student must change their password on first login (mustChangePassword).
 */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const { program, standard } = readNewStudent(body);
  const batch = await readStudentBatch(body.batchId, tuitionId);
  if (batch) mustFit({ program, standard }, batch);

  const studentName = text(body, "name", { required: true, max: 100, label: "the student's name" })!;
  const studentEmail = email(body);
  const studentPhone = text(body, "phone", { max: 20 }) ?? "";
  const parentPhone = text(body, "parentPhone", { max: 20 }) ?? "";
  const rawPassword = password(body);

  // Determine enrollment method (only meaningful when a batch is selected).
  // Default to immediate enrollment for backward compatibility with older app
  // versions and API callers that don't send enrollmentMethod.
  const enrollmentMethod: EnrollmentMethod | null = batch
    ? (body.enrollmentMethod !== undefined ? oneOf(body, "enrollmentMethod", ENROLLMENT_METHODS, "an enrollment method") : "enroll_immediately")
    : null;

  const immediateEnroll = batch && enrollmentMethod === "enroll_immediately";

  // Create the student account.
  const student = (await User.create({
    role: "student",
    emailVerified: true,
    tuitionId,
    name: studentName,
    email: studentEmail,
    phone: studentPhone,
    parentPhone,
    program,
    track: PROGRAM_INFO[program].track,
    standard,
    batchId: immediateEnroll ? batch._id : null,
    passwordHash: await hashPassword(rawPassword),
    mustChangePassword: true,
    accountStatus: "invited",
    invitationStatus: "pending_send",
    invitedAt: new Date(),
  })) as UserDoc;

  // Create a pending request if not enrolling immediately.
  let pendingCreated = false;
  if (!immediateEnroll) {
    try {
      await JoinRequest.create({
        userId: student._id,
        tuitionId,
        role: "student",
        batchId: batch?._id ?? null,
        status: "pending",
        source: "admin_created",
      });
      pendingCreated = true;
    } catch (error) {
      // Unique index: one pending per user. Shouldn't happen for a brand-new user.
      console.error("[students] couldn't create enrollment request:", error);
    }
  }

  // Send welcome email. Failure doesn't roll back account creation.
  const tuition = await Tuition.findById(tuitionId).select("name").lean<{ name: string }>();
  const tuitionName = tuition?.name ?? "Your Tuition";
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const batchStatus: "enrolled" | "approval" | "pending" = immediateEnroll ? "enrolled" : batch ? "approval" : "pending";
    await sendMail(studentWelcomeEmail({
      studentName,
      tuitionName,
      email: studentEmail,
      password: rawPassword,
      batchStatus,
      batchName: batch?.name,
    }));
    emailSent = true;
    await User.updateOne({ _id: student._id }, { invitationStatus: "sent" });
  } catch (error) {
    emailError = error instanceof Error ? error.message : "Couldn't send the email.";
    console.error("[students] welcome email failed:", error);
    await User.updateOne({ _id: student._id }, { invitationStatus: "send_failed" });
  }

  const names = await batchNames(tuitionId);
  return {
    student: studentOut(student, names),
    enrollment: immediateEnroll ? "enrolled" : batch ? "approval_pending" : "batch_pending",
    pendingCreated,
    emailSent,
    emailError,
  };
});
