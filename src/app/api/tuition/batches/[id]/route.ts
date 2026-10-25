import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { coverageFor } from "@/lib/syllabus";
import { batchNames, batchOut, findBatch, readBatch, studentOut, teacherNames } from "@/lib/tuition";
import Announcement from "@/models/Announcement";
import SyllabusProgress from "@/models/SyllabusProgress";
import TestAttempt from "@/models/TestAttempt";
import TestRoom from "@/models/TestRoom";
import TimetableEntry from "@/models/TimetableEntry";
import User, { type UserDoc } from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** A batch with its students and syllabus coverage. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  const [students, names, batchNameMap, coverage] = await Promise.all([
    User.find({ tuitionId, role: "student", batchId: batch._id }).sort({ name: 1 }) as Promise<UserDoc[]>,
    teacherNames(tuitionId),
    batchNames(tuitionId),
    coverageFor([batch]),
  ]);
  return {
    batch: { ...batchOut(batch, names, students.length), coverage: coverage.get(String(batch._id)) ?? {} },
    students: students.map((s) => studentOut(s, batchNameMap)),
  };
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  batch.set(await readBatch(await readJson(req), tuitionId, batch));
  await batch.save();
  const count = await User.countDocuments({ tuitionId, role: "student", batchId: batch._id });
  return { batch: batchOut(batch, await teacherNames(tuitionId), count) };
});

/** Deletes the batch with its timetable, tests and syllabus progress. Its students stay enrolled, without a batch. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  await Promise.all([
    User.updateMany({ tuitionId, batchId: batch._id }, { batchId: null }),
    SyllabusProgress.deleteMany({ batchId: batch._id }),
    TimetableEntry.deleteMany({ batchId: batch._id }),
    TestRoom.deleteMany({ batchId: batch._id }),
    TestAttempt.deleteMany({ batchId: batch._id }),
    // Notices to this batch alone go; others just stop listing it (an empty
    // list would mean "every batch").
    Announcement.deleteMany({ tuitionId, batchIds: { $size: 1, $all: [batch._id] } }),
  ]);
  await Announcement.updateMany({ tuitionId, batchIds: batch._id }, { $pull: { batchIds: batch._id } });
  await batch.deleteOne();
  return { ok: true };
});
