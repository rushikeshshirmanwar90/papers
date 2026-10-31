import { hashPassword, requireUser } from "@/lib/auth";
import { email, isObjectId, password, readJson, route, text } from "@/lib/http";
import { PROGRAM_INFO } from "@/lib/school";
import { batchNames, mustFit, readNewStudent, readStudentBatch, studentOut } from "@/lib/tuition";
import User, { type UserDoc } from "@/models/User";

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
  const q = params.get("q")?.trim();
  if (q) {
    const re = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    filter.$or = [{ name: re }, { email: re }];
  }
  const [students, names] = await Promise.all([
    User.find(filter).sort({ name: 1 }).limit(500) as Promise<UserDoc[]>,
    batchNames(tuitionId),
  ]);
  return { students: students.map((s) => studentOut(s, names)) };
});

/**
 * Enrolls a student with a starting password the tuition gives them:
 * { name, email, password, program (or an older app's track), standard, batchId?, phone?, parentPhone? }.
 * With `program`: JEE or NEET, and the class is required. The batch must be
 * of the student's program and class; it's optional.
 */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const { program, standard } = readNewStudent(body);
  const batch = await readStudentBatch(body.batchId, tuitionId);
  mustFit({ program, standard }, batch);
  const student = (await User.create({
    role: "student",
    emailVerified: true,
    tuitionId,
    name: text(body, "name", { required: true, max: 100, label: "the student's name" }),
    email: email(body),
    phone: text(body, "phone", { max: 20 }) ?? "",
    parentPhone: text(body, "parentPhone", { max: 20 }) ?? "",
    program,
    track: PROGRAM_INFO[program].track,
    standard,
    batchId: batch?._id ?? null,
    passwordHash: await hashPassword(password(body)),
  })) as UserDoc;
  return { student: studentOut(student, await batchNames(tuitionId)) };
});
