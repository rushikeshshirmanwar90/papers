import { hashPassword, requireUser } from "@/lib/auth";
import { email, isObjectId, oneOf, password, readJson, route, text } from "@/lib/http";
import { STANDARDS, TRACKS } from "@/lib/school";
import { batchNames, readBatchId, studentOut } from "@/lib/tuition";
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

/** Enrolls a student with a starting password the tuition gives them. */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const student = (await User.create({
    role: "student",
    tuitionId,
    name: text(body, "name", { required: true, max: 100, label: "the student's name" }),
    email: email(body),
    phone: text(body, "phone", { max: 20 }) ?? "",
    parentPhone: text(body, "parentPhone", { max: 20 }) ?? "",
    track: oneOf(body, "track", TRACKS, "a track"),
    standard: body.standard ? oneOf(body, "standard", STANDARDS, "a class") : undefined,
    batchId: await readBatchId(body.batchId, tuitionId),
    passwordHash: await hashPassword(password(body)),
  })) as UserDoc;
  return { student: studentOut(student, await batchNames(tuitionId)) };
});
