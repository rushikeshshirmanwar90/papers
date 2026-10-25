import { Types } from "mongoose";
import { badRequest, isObjectId, listOf, notFound, oneOf, text } from "@/lib/http";
import { STANDARDS, SUBJECTS, SUBJECTS_BY_TRACK, TRACKS, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";
import Batch, { type BatchDoc, type BatchSlot } from "@/models/Batch";
import User, { type UserDoc } from "@/models/User";

// The tuition's own data — batches, teachers and students — checked and
// shaped the same way by every route that touches it. Every lookup is scoped
// to the signed-in user's tuition.

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (time: string) => {
  const [, h, m] = TIME.exec(time)!;
  return Number(h) * 60 + Number(m);
};

/** Accepts "9:05" or "09:05"; returns "09:05". */
function normaliseTime(value: unknown, label: string): string {
  if (typeof value !== "string") throw badRequest(`Enter ${label} as HH:MM.`);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const time = match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
  if (!TIME.test(time)) throw badRequest(`${label} must be a 24-hour time like 16:30.`);
  return time;
}

export function readSchedule(value: unknown): BatchSlot[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest("The timings must be a list.");
  if (value.length > 21) throw badRequest("A batch can have at most 21 class slots a week.");
  const slots = value.map((raw, i) => {
    const slot = (raw ?? {}) as Record<string, unknown>;
    const day = Number(slot.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw badRequest(`Pick a day for class slot ${i + 1}.`);
    const start = normaliseTime(slot.start, `the start time of slot ${i + 1}`);
    const end = normaliseTime(slot.end, `the end time of slot ${i + 1}`);
    if (minutesOf(end) <= minutesOf(start)) throw badRequest(`Class slot ${i + 1} must end after it starts.`);
    return { day, start, end };
  });
  return slots.sort((a, b) => a.day - b.day || minutesOf(a.start) - minutesOf(b.start));
}

/** Minutes of class a week. */
export const weeklyMinutes = (schedule: BatchSlot[]) => schedule.reduce((sum, s) => sum + minutesOf(s.end) - minutesOf(s.start), 0);

/** The batch's teachers: each an active teacher of this tuition, for one of the batch's subjects. */
export async function readBatchTeachers(value: unknown, tuitionId: string, subjects: SchoolSubject[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest("Teachers must be a list.");
  const entries = value.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    if (!isObjectId(entry.teacherId)) throw badRequest("Pick a teacher for each subject.");
    const subject = oneOf(entry, "subject", SUBJECTS, "a subject");
    if (!subjects.includes(subject)) throw badRequest(`${subject} isn't one of this batch's subjects.`);
    return { teacherId: new Types.ObjectId(entry.teacherId), subject };
  });
  const ids = [...new Set(entries.map((e) => String(e.teacherId)))];
  const found = await User.countDocuments({ _id: { $in: ids }, tuitionId, role: "teacher" });
  if (found !== ids.length) throw badRequest("One of the teachers isn't part of this tuition.");
  // One teacher per subject.
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.subject) ? false : (seen.add(e.subject), true)));
}

/** The batch's fields from a create or edit request. */
export async function readBatch(body: Record<string, unknown>, tuitionId: string, existing?: BatchDoc) {
  const track = body.track !== undefined ? oneOf(body, "track", TRACKS, "a track") : (existing?.track as Track);
  if (!track) throw badRequest("Choose a track: NEET, JEE or General.");
  const allowed = SUBJECTS_BY_TRACK[track];
  const subjects =
    body.subjects !== undefined
      ? listOf(body, "subjects", SUBJECTS, "Subjects")
      : existing && body.track === undefined
      ? existing.subjects
      : allowed;
  const outside = subjects.filter((s) => !allowed.includes(s));
  if (outside.length) throw badRequest(`${outside.join(", ")} isn't part of the ${track} track.`);
  if (!subjects.length) throw badRequest("Pick at least one subject.");

  const fields: Partial<BatchDoc> & Record<string, unknown> = { track, subjects };
  if (body.name !== undefined || !existing) fields.name = text(body, "name", { required: true, max: 80, label: "a batch name" });
  if (body.standard !== undefined) {
    fields.standard = body.standard === null || body.standard === "" ? undefined : oneOf(body, "standard", STANDARDS, "a class");
  }
  if (body.venue !== undefined) fields.venue = text(body, "venue", { max: 200 }) ?? "";
  if (body.schedule !== undefined) fields.schedule = readSchedule(body.schedule);
  if (body.teachers !== undefined) {
    fields.teachers = await readBatchTeachers(body.teachers, tuitionId, subjects);
  } else if (existing) {
    // Drop teachers of subjects the batch no longer has.
    fields.teachers = existing.teachers.filter((t) => subjects.includes(t.subject));
  }
  return fields;
}

export async function findBatch(tuitionId: string, id: unknown) {
  if (!isObjectId(id)) throw notFound("This batch");
  const batch = await Batch.findOne({ _id: id, tuitionId });
  if (!batch) throw notFound("This batch");
  return batch as BatchDoc;
}

export async function findMember(tuitionId: string, id: unknown, role: "teacher" | "student") {
  const what = role === "teacher" ? "This teacher" : "This student";
  if (!isObjectId(id)) throw notFound(what);
  const user = await User.findOne({ _id: id, tuitionId, role });
  if (!user) throw notFound(what);
  return user as UserDoc;
}

// ─── What the app gets ─────────────────────────────────────────────────────

type NameMap = Map<string, string>;

export async function teacherNames(tuitionId: string): Promise<NameMap> {
  const teachers = await User.find({ tuitionId, role: "teacher" }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(teachers.map((t) => [String(t._id), t.name]));
}

export function batchOut(batch: BatchDoc, names: NameMap, studentCount: number) {
  return {
    id: String(batch._id),
    name: batch.name,
    track: batch.track,
    standard: batch.standard ?? null,
    subjects: batch.subjects,
    venue: batch.venue,
    schedule: batch.schedule.map(({ day, start, end }) => ({ day, start, end })),
    weeklyMinutes: weeklyMinutes(batch.schedule),
    teachers: batch.teachers.map((t) => ({
      teacherId: String(t.teacherId),
      name: names.get(String(t.teacherId)) ?? "Removed teacher",
      subject: t.subject,
    })),
    studentCount,
  };
}

export async function studentCounts(tuitionId: string): Promise<Map<string, number>> {
  const counts = await User.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { tuitionId: new Types.ObjectId(tuitionId), role: "student", batchId: { $ne: null } } },
    { $group: { _id: "$batchId", n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [String(c._id), c.n]));
}

export function teacherOut(teacher: UserDoc, batches: BatchDoc[]) {
  const id = String(teacher._id);
  return {
    id,
    name: teacher.name,
    email: teacher.email,
    phone: teacher.phone,
    subjects: teacher.subjects,
    active: teacher.active,
    lastLoginAt: teacher.lastLoginAt,
    batches: batches.flatMap((b) =>
      b.teachers.filter((t) => String(t.teacherId) === id).map((t) => ({ id: String(b._id), name: b.name, subject: t.subject }))
    ),
  };
}

export function studentOut(student: UserDoc, batchNames: NameMap) {
  const batchId = student.batchId ? String(student.batchId) : null;
  return {
    id: String(student._id),
    name: student.name,
    email: student.email,
    phone: student.phone,
    parentPhone: student.parentPhone ?? "",
    track: student.track ?? null,
    standard: student.standard ?? null,
    batch: batchId ? { id: batchId, name: batchNames.get(batchId) ?? "" } : null,
    active: student.active,
    lastLoginAt: student.lastLoginAt,
    createdAt: student.createdAt,
  };
}

export async function batchNames(tuitionId: string): Promise<NameMap> {
  const batches = await Batch.find({ tuitionId }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(batches.map((b) => [String(b._id), b.name]));
}

/** The batch id from a request, checked to be this tuition's; null clears it. */
export async function readBatchId(value: unknown, tuitionId: string): Promise<Types.ObjectId | null> {
  if (value === null || value === "" || value === undefined) return null;
  if (!isObjectId(value) || !(await Batch.exists({ _id: value, tuitionId }))) throw badRequest("Pick one of your batches.");
  return new Types.ObjectId(value);
}

export type { SchoolStandard, SchoolSubject, Track };
