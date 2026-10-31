import { Types } from "mongoose";
import { badRequest, isObjectId, listOf, notFound, oneOf, text } from "@/lib/http";
import {
  academicYearOf,
  fitProblem,
  isOffered,
  notOffered,
  parseAcademicYear,
  PROGRAM_INFO,
  programFromTrack,
  programOf,
  PROGRAMS,
  STANDARDS,
  SUBJECTS,
  subjectProblem,
  TRACKS,
  type Program,
  type SchoolStandard,
  type SchoolSubject,
  type Track,
} from "@/lib/school";
import type { TimetableSummary } from "@/lib/timetable";
import Batch, { type BatchDoc, type BatchSlot } from "@/models/Batch";
import User, { type UserDoc } from "@/models/User";

// The tuition's own data — batches, teachers and students — checked and
// shaped the same way by every route that touches it. Every lookup is scoped
// to the signed-in user's tuition.

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
  slots.sort((a, b) => a.day - b.day || minutesOf(a.start) - minutesOf(b.start));
  // Classes of one batch can't overlap (back to back is fine).
  for (let i = 1; i < slots.length; i++) {
    const [before, after] = [slots[i - 1], slots[i]];
    if (before.day === after.day && minutesOf(after.start) < minutesOf(before.end)) {
      throw badRequest(`Two classes overlap on ${DAY_NAMES[after.day]}: ${before.start}–${before.end} and ${after.start}–${after.end}.`);
    }
  }
  return slots;
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

/**
 * The program from { program } or, from older app versions, { track }.
 * A legacy track keeps `current` when it's that program's track (an older
 * app editing an MHT-CET batch sends track "General"). undefined: unchanged.
 */
export function readProgram(body: Record<string, unknown>, current: Program | null): Program | undefined {
  if (body.program !== undefined) {
    const program = oneOf(body, "program", PROGRAMS, "a program");
    if (body.track !== undefined && body.track !== null && oneOf(body, "track", TRACKS, "a track") !== PROGRAM_INFO[program].track) {
      throw badRequest(`The track doesn't match ${PROGRAM_INFO[program].label}.`);
    }
    return program;
  }
  if (body.track !== undefined) {
    const track = oneOf(body, "track", TRACKS, "a track");
    return current && PROGRAM_INFO[current].track === track ? current : programFromTrack(track);
  }
  return undefined;
}

/** The academic year from a request, as "2026-2027". */
export function readAcademicYear(value: unknown): string {
  const year = parseAcademicYear(value);
  if (!year) throw badRequest("Enter the academic year as a year and the next, like 2026-2027.");
  return year;
}

/**
 * The batch's fields from a create or edit request. Requests that name a
 * `program` (this app version) must give the class, 11th or 12th, and get
 * this academic year unless they give one. Older requests (track only) keep
 * their old rules, so older app versions still work.
 */
export async function readBatch(body: Record<string, unknown>, tuitionId: string, existing?: BatchDoc) {
  const current = existing ? programOf(existing) : null;
  const program = readProgram(body, current) ?? current;
  if (!program) throw badRequest("Choose a program.");
  const byProgram = body.program !== undefined;
  const changed = program !== current;
  // New batches, and moves to another program, only for the offered programs.
  if (byProgram && changed && !isOffered(program)) throw badRequest(notOffered(program));

  const subjects =
    body.subjects !== undefined ? listOf(body, "subjects", SUBJECTS, "Subjects") : existing && !changed ? existing.subjects : [...PROGRAM_INFO[program].subjects];
  const problem = subjectProblem(program, subjects);
  if (problem) throw badRequest(problem);

  const fields: Partial<BatchDoc> & Record<string, unknown> = { program, track: PROGRAM_INFO[program].track, subjects };
  if (body.name !== undefined || !existing) fields.name = text(body, "name", { required: true, max: 80, label: "a batch name" });
  const given = (value: unknown) => value !== undefined && value !== null && value !== "";
  if (given(body.standard)) {
    fields.standard = oneOf(body, "standard", STANDARDS, "the class");
  } else if (byProgram && (body.standard !== undefined || !existing)) {
    throw badRequest("Choose the class: 11th or 12th.");
  } else if (body.standard !== undefined) {
    fields.standard = undefined; // an older app's "11th & 12th"
  }
  if (given(body.academicYear)) {
    fields.academicYear = readAcademicYear(body.academicYear);
  } else if (body.academicYear !== undefined && existing?.academicYear) {
    throw badRequest("Choose the academic year.");
  } else if (byProgram && !existing) {
    fields.academicYear = academicYearOf();
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

/**
 * Refuses a change of the batch's program or class while any of its
 * students would no longer fit it. Students are never changed for it.
 */
export async function mustKeepStudentsFitting(batch: BatchDoc, before: { program: Program | null; standard: SchoolStandard | null }) {
  if (programOf(batch) === before.program && (batch.standard ?? null) === before.standard) return;
  const students = await User.find({ tuitionId: batch.tuitionId, role: "student", batchId: batch._id })
    .select("name program track standard")
    .lean<{ name: string; program?: Program; track?: Track; standard?: SchoolStandard }[]>();
  const misfits = students.filter((s) => fitProblem(s, batch));
  if (!misfits.length) return;
  const names = misfits.slice(0, 3).map((s) => s.name).join(", ");
  const count = misfits.length === 1 ? "1 student" : `${misfits.length} students`;
  throw badRequest(
    `${count} in this batch (${names}${misfits.length > 3 ? "…" : ""}) ${misfits.length === 1 ? "is" : "are"} in another program or class. Move them to another batch first, or keep the batch's program and class.`
  );
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

/**
 * A batch as the app gets it. `classes` sums up its subject timetable
 * (TimetableEntry); `schedule` and `weeklyMinutes` are the older time-only
 * slots, kept for older app versions.
 */
export function batchOut(batch: BatchDoc, names: NameMap, studentCount: number, classes?: TimetableSummary) {
  return {
    id: String(batch._id),
    name: batch.name,
    program: programOf(batch),
    track: batch.track,
    standard: batch.standard ?? null,
    academicYear: batch.academicYear ?? null,
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
    ...(classes ? { classes } : {}),
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
    createdAt: teacher.createdAt,
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
    program: programOf(student),
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

/** The batch from a request, checked to be this tuition's; null clears it. */
export async function readStudentBatch(value: unknown, tuitionId: string): Promise<BatchDoc | null> {
  if (value === null || value === "" || value === undefined) return null;
  const batch = isObjectId(value) ? ((await Batch.findOne({ _id: value, tuitionId })) as BatchDoc | null) : null;
  if (!batch) throw badRequest("Pick one of your batches.");
  return batch;
}

/**
 * A student's program and class from a create or accept request. Requests
 * that name a `program` (this app version) need an offered program and the
 * class; older requests (track only) keep their old rules.
 */
export function readNewStudent(body: Record<string, unknown>): { program: Program; standard: SchoolStandard | undefined } {
  const program = readProgram(body, null);
  if (!program) throw badRequest("Choose the student's program.");
  const standard = body.standard ? oneOf(body, "standard", STANDARDS, "a class") : undefined;
  if (body.program !== undefined) {
    if (!isOffered(program)) throw badRequest(notOffered(program));
    if (!standard) throw badRequest("Choose the student's class: 11th or 12th.");
  }
  return { program, standard };
}

/** Refuses putting a student in a batch of another program or class. */
export function mustFit(student: Parameters<typeof fitProblem>[0], batch: BatchDoc | null) {
  const problem = batch ? fitProblem(student, batch) : null;
  if (problem) throw badRequest(`${problem} Change the student's program or class first, or pick another batch.`);
}

/** The batch id from a request, checked to be this tuition's; null clears it. */
export async function readBatchId(value: unknown, tuitionId: string): Promise<Types.ObjectId | null> {
  if (value === null || value === "" || value === undefined) return null;
  if (!isObjectId(value) || !(await Batch.exists({ _id: value, tuitionId }))) throw badRequest("Pick one of your batches.");
  return new Types.ObjectId(value);
}

export type { Program, SchoolStandard, SchoolSubject, Track };
