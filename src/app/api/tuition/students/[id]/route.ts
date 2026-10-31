import { requireUser } from "@/lib/auth";
import { badRequest, email, oneOf, readJson, route, text } from "@/lib/http";
import { isOffered, notOffered, PROGRAM_INFO, programOf, STANDARDS } from "@/lib/school";
import { batchNames, findMember, mustFit, readProgram, readStudentBatch, studentOut } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
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

/**
 * Edits a student, moves them to another batch, or turns their login off/on.
 * When the program, class or batch changes, the batch must be of the
 * student's program and class.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const student = await findMember(tuitionId, params.id, "student");
  const body = await readJson(req);
  const before = { program: programOf(student), standard: student.standard ?? null, batchId: student.batchId ? String(student.batchId) : null };

  if (body.name !== undefined) student.name = text(body, "name", { required: true, max: 100, label: "the student's name" })!;
  if (body.email !== undefined) student.email = email(body);
  if (body.phone !== undefined) student.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.parentPhone !== undefined) student.parentPhone = text(body, "parentPhone", { max: 20 }) ?? "";
  const program = readProgram(body, before.program);
  if (program && body.program !== undefined && program !== before.program && !isOffered(program)) throw badRequest(notOffered(program));
  if (program) {
    student.program = program;
    student.track = PROGRAM_INFO[program].track;
  }
  if (body.standard !== undefined) {
    student.standard = body.standard ? oneOf(body, "standard", STANDARDS, "a class") : undefined;
  }
  let batch: BatchDoc | null | undefined;
  if (body.batchId !== undefined) {
    batch = await readStudentBatch(body.batchId, tuitionId);
    student.batchId = batch?._id ?? null;
  }
  const moved = (student.batchId ? String(student.batchId) : null) !== before.batchId;
  if (moved || programOf(student) !== before.program || (student.standard ?? null) !== before.standard) {
    if (batch === undefined && student.batchId) batch = (await Batch.findOne({ _id: student.batchId, tuitionId })) as BatchDoc | null;
    mustFit(student, batch ?? null);
  }
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
  await User.updateOne({ _id: student._id }, { role: null, tuitionId: null, batchId: null, program: null, track: null, standard: null });
  return { ok: true };
});
