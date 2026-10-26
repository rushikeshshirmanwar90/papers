import { requireUser } from "@/lib/auth";
import { email, listOf, readJson, route, text } from "@/lib/http";
import { SUBJECTS } from "@/lib/school";
import { findMember, teacherOut } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import TimetableEntry from "@/models/TimetableEntry";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const teacher = await findMember(tuitionId, params.id, "teacher");
  const batches = (await Batch.find({ tuitionId, "teachers.teacherId": teacher._id })) as BatchDoc[];
  return { teacher: teacherOut(teacher, batches) };
});

/** Edits a teacher: name, email, phone, subjects, or turns their login off/on. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const teacher = await findMember(tuitionId, params.id, "teacher");
  const body = await readJson(req);

  if (body.name !== undefined) teacher.name = text(body, "name", { required: true, max: 100, label: "the teacher's name" })!;
  if (body.email !== undefined) teacher.email = email(body);
  if (body.phone !== undefined) teacher.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.subjects !== undefined) teacher.subjects = listOf(body, "subjects", SUBJECTS, "Subjects");
  if (body.active !== undefined) {
    teacher.active = body.active === true;
    // Turning a login off signs it out everywhere.
    if (!teacher.active) teacher.tokenVersion += 1;
  }
  await teacher.save();

  // A teacher who no longer teaches a subject leaves the batches they taught it to.
  if (body.subjects !== undefined) {
    await Batch.updateMany(
      { tuitionId, "teachers.teacherId": teacher._id },
      { $pull: { teachers: { teacherId: teacher._id, subject: { $nin: teacher.subjects } } } }
    );
  }
  const batches = (await Batch.find({ tuitionId, "teachers.teacherId": teacher._id })) as BatchDoc[];
  return { teacher: teacherOut(teacher, batches) };
});

/** Takes the teacher out of the tuition (their account stays); their batches keep going without them. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const teacher = await findMember(tuitionId, params.id, "teacher");
  await Batch.updateMany({ tuitionId }, { $pull: { teachers: { teacherId: teacher._id } } });
  // Their weekly classes go; tests they set stay, for the students' results.
  await TimetableEntry.deleteMany({ tuitionId, teacherId: teacher._id });
  // Their account stays (they may join another tuition); they leave this one.
  await User.updateOne({ _id: teacher._id }, { role: null, tuitionId: null, subjects: [], batchId: null });
  return { ok: true };
});
