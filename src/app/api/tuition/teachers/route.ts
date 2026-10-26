import { hashPassword, requireUser } from "@/lib/auth";
import { email, listOf, password, readJson, route, text } from "@/lib/http";
import { SUBJECTS } from "@/lib/school";
import { teacherOut } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import User, { type UserDoc } from "@/models/User";

export const dynamic = "force-dynamic";

/** The tuition's teachers, by name, each with the batches and subjects they teach. */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const [teachers, batches] = await Promise.all([
    User.find({ tuitionId, role: "teacher" }).sort({ name: 1 }) as Promise<UserDoc[]>,
    Batch.find({ tuitionId }).select("name teachers") as Promise<BatchDoc[]>,
  ]);
  return { teachers: teachers.map((t) => teacherOut(t, batches)) };
});

/** Adds a teacher with a starting password the tuition gives them. */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const teacher = (await User.create({
    role: "teacher",
    emailVerified: true,
    tuitionId,
    name: text(body, "name", { required: true, max: 100, label: "the teacher's name" }),
    email: email(body),
    phone: text(body, "phone", { max: 20 }) ?? "",
    subjects: listOf(body, "subjects", SUBJECTS, "Subjects"),
    passwordHash: await hashPassword(password(body)),
  })) as UserDoc;
  return { teacher: teacherOut(teacher, []) };
});
