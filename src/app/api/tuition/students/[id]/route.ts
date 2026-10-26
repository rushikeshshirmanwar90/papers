import { requireUser } from "@/lib/auth";
import { email, oneOf, readJson, route, text } from "@/lib/http";
import { STANDARDS, TRACKS } from "@/lib/school";
import { batchNames, findMember, readBatchId, studentOut } from "@/lib/tuition";
import PracticeAnswer from "@/models/PracticeAnswer";
import TestAttempt from "@/models/TestAttempt";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");
  return { student: studentOut(student, await batchNames(tuitionId)) };
});

/** Edits a student, moves them to another batch, or turns their login off/on. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");
  const body = await readJson(req);

  if (body.name !== undefined) student.name = text(body, "name", { required: true, max: 100, label: "the student's name" })!;
  if (body.email !== undefined) student.email = email(body);
  if (body.phone !== undefined) student.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.parentPhone !== undefined) student.parentPhone = text(body, "parentPhone", { max: 20 }) ?? "";
  if (body.track !== undefined) student.track = oneOf(body, "track", TRACKS, "a track");
  if (body.standard !== undefined) {
    student.standard = body.standard ? oneOf(body, "standard", STANDARDS, "a class") : undefined;
  }
  if (body.batchId !== undefined) student.batchId = await readBatchId(body.batchId, tuitionId);
  if (body.active !== undefined) {
    student.active = body.active === true;
    if (!student.active) student.tokenVersion += 1;
  }
  await student.save();
  return { student: studentOut(student, await batchNames(tuitionId)) };
});

/** Takes the student out of the tuition, with their test attempts and practice answers; their account stays. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");
  await TestAttempt.deleteMany({ studentId: student._id });
  await PracticeAnswer.deleteMany({ studentId: student._id });
  // Their account stays (they may join another tuition); they leave this one.
  await User.updateOne({ _id: student._id }, { role: null, tuitionId: null, batchId: null, track: null, standard: null });
  return { ok: true };
});
