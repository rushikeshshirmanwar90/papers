import { Types } from "mongoose";
import type { Session } from "@/lib/auth";
import { HttpError, badRequest, isObjectId, oneOf, text } from "@/lib/http";
import { SUBJECTS } from "@/lib/school";
import { batchFor, mustTeach } from "@/lib/teaching";
import { readSchedule } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";
import User from "@/models/User";

// The subject-wise weekly timetable: TimetableEntry, one document per class
// (batch, subject, weekday, start, end, optional teacher, note). It's the
// one timetable students, teachers and the tuition see. Batch.schedule holds
// older time-only slots; they're kept as they are and never turned into
// classes here.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const time12 = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3)} ${h >= 12 ? "PM" : "AM"}`;
};

export type EntryFields = {
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId;
  teacherId: Types.ObjectId | null;
  subject: (typeof SUBJECTS)[number];
  day: number;
  start: string;
  end: string;
  note: string;
};

/** The weekdays from { days: [1, 3, 5] } or { day: 1 }; an edit keeps its day unless given. */
function readDays(body: Record<string, unknown>, existing?: TimetableEntryDoc): number[] {
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || !body.days.length) throw badRequest("Pick at least one day.");
    if (body.days.some((d) => typeof d !== "number" && (typeof d !== "string" || !/^[0-6]$/.test(d)))) throw badRequest("Days must be 0 (Sunday) to 6 (Saturday).");
    const days = [...new Set(body.days.map(Number))];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw badRequest("Days must be 0 (Sunday) to 6 (Saturday).");
    return days.sort((a, b) => a - b);
  }
  return [Number(body.day ?? existing?.day)];
}

/**
 * Reads and checks a class (or the same class on several days): batch,
 * subject (one of the batch's), days, start and end, teacher and note.
 * A teacher adds their own classes; the tuition picks the teacher, who must
 * teach the subject, or none ({ teacherId: null }). Left out, it's the
 * batch's teacher for the subject, if it has one.
 */
export async function readEntries(session: Session, body: Record<string, unknown>, existing?: TimetableEntryDoc): Promise<{ batch: BatchDoc; entries: EntryFields[] }> {
  const batch: BatchDoc = await batchFor(session, body.batchId ?? existing?.batchId);
  const subject = body.subject !== undefined || !existing ? oneOf(body, "subject", SUBJECTS, "a subject") : existing.subject;
  mustTeach(session, batch, subject);

  const days = readDays(body, existing);
  if (existing && days.length !== 1) throw badRequest("A class is on one day. Add the other days as new classes.");
  // The times reuse the batch timing checks: a real day, a start before the end.
  const slots = readSchedule(days.map((day) => ({ day, start: body.start ?? existing?.start, end: body.end ?? existing?.end })));

  let teacherId: Types.ObjectId | null;
  if (session.role === "teacher") teacherId = session.user._id as Types.ObjectId;
  else if (body.teacherId !== undefined) {
    if (body.teacherId === null || body.teacherId === "") teacherId = null;
    else {
      const teacher = isObjectId(body.teacherId)
        ? await User.findOne({ _id: body.teacherId, tuitionId: session.tuitionId, role: "teacher" }).select("name subjects").lean<{ _id: Types.ObjectId; name: string; subjects: string[] }>()
        : null;
      if (!teacher) throw badRequest("Pick one of your teachers.");
      if (!teacher.subjects.includes(subject)) throw badRequest(`${teacher.name} doesn't teach ${subject}. Pick a ${subject} teacher, or none for now.`);
      teacherId = teacher._id;
    }
  } else if (existing && subject === existing.subject && String(batch._id) === String(existing.batchId)) teacherId = existing.teacherId ?? null;
  else teacherId = batch.teachers.find((t) => t.subject === subject)?.teacherId ?? null;

  const note = body.note !== undefined ? text(body, "note", { max: 200 }) ?? "" : existing?.note ?? "";
  return { batch, entries: slots.map((slot) => ({ tuitionId: batch.tuitionId, batchId: batch._id as Types.ObjectId, teacherId, subject, ...slot, note })) };
}

/**
 * Throws 409 when a class overlaps another class of the same batch, or of
 * the same teacher in any of the tuition's batches. Back to back is fine.
 */
export async function checkClashes(entries: EntryFields[], exceptId?: Types.ObjectId) {
  if (!entries.length) return;
  const { tuitionId, batchId, teacherId } = entries[0];
  const others = await TimetableEntry.find({
    tuitionId,
    day: { $in: entries.map((e) => e.day) },
    $or: [{ batchId }, ...(teacherId ? [{ teacherId }] : [])],
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).lean<{ batchId: Types.ObjectId; teacherId: Types.ObjectId | null; subject: string; day: number; start: string; end: string }[]>();
  for (const e of entries) {
    const clash = others.find((o) => o.day === e.day && minutes(o.start) < minutes(e.end) && minutes(e.start) < minutes(o.end));
    if (!clash) continue;
    const when = `${WEEKDAYS[e.day]}, ${time12(clash.start)}–${time12(clash.end)}`;
    if (String(clash.batchId) === String(batchId)) throw new HttpError(409, `This overlaps the batch's ${clash.subject} class on ${when}.`);
    const other = await Batch.findById(clash.batchId).select("name").lean<{ name: string }>();
    throw new HttpError(409, `The teacher already has a ${clash.subject} class with ${other?.name ?? "another batch"} on ${when}.`);
  }
}

/** Classes as the app shows them: batch, teacher (empty when none) and whether it's the user's own. */
export async function entriesOut(session: Session, entries: TimetableEntryDoc[]) {
  const teacherIds = entries.map((e) => e.teacherId).filter((id): id is Types.ObjectId => !!id);
  const [batches, teachers] = await Promise.all([
    Batch.find({ _id: { $in: entries.map((e) => e.batchId) } }).select("name venue").lean<{ _id: Types.ObjectId; name: string; venue: string }[]>(),
    User.find({ _id: { $in: teacherIds } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  return entries.map((e) => {
    const batch = batches.find((b) => String(b._id) === String(e.batchId));
    const teacherId = e.teacherId ? String(e.teacherId) : "";
    return {
      id: String(e._id),
      batch: { id: String(e.batchId), name: batch?.name ?? "", venue: batch?.venue ?? "" },
      teacher: { id: teacherId, name: teacherId ? teachers.find((t) => String(t._id) === teacherId)?.name ?? "" : "" },
      subject: e.subject,
      day: e.day,
      start: e.start,
      end: e.end,
      note: e.note,
      mine: !!teacherId && teacherId === session.userId,
    };
  });
}

export interface TimetableSummary {
  /** Classes a week. */
  classes: number;
  weeklyMinutes: number;
  /** Weekdays with a class, 0 = Sunday. */
  days: number[];
  /** Classes with no teacher yet. */
  withoutTeacher: number;
}

/** Each batch's subject timetable at a glance. */
export async function timetableSummaries(tuitionId: string | Types.ObjectId, batchIds?: Types.ObjectId[]): Promise<Map<string, TimetableSummary>> {
  const rows = await TimetableEntry.find({ tuitionId, ...(batchIds ? { batchId: { $in: batchIds } } : {}) })
    .select("batchId day start end teacherId")
    .lean<{ batchId: Types.ObjectId; day: number; start: string; end: string; teacherId: Types.ObjectId | null }[]>();
  const out = new Map<string, TimetableSummary>();
  for (const r of rows) {
    const key = String(r.batchId);
    const s = out.get(key) ?? { classes: 0, weeklyMinutes: 0, days: [], withoutTeacher: 0 };
    s.classes += 1;
    s.weeklyMinutes += minutes(r.end) - minutes(r.start);
    if (!s.days.includes(r.day)) s.days.push(r.day);
    if (!r.teacherId) s.withoutTeacher += 1;
    out.set(key, s);
  }
  for (const s of out.values()) s.days.sort((a, b) => a - b);
  return out;
}

export const EMPTY_SUMMARY: TimetableSummary = { classes: 0, weeklyMinutes: 0, days: [], withoutTeacher: 0 };

/** Tells the batch's students their timetable changed (once an hour at most). */
export async function announceTimetableChange(session: Session, batchId: Types.ObjectId, subject: string) {
  const { membersOf, pushOnce } = await import("@/lib/push");
  const batch = await Batch.findById(batchId).select("name").lean<{ name: string }>();
  const hour = new Date().toISOString().slice(0, 13);
  await pushOnce(`timetable:${batchId}:${hour}`, await membersOf(session.tuitionId, [batchId], ["student"]), {
    title: "Timetable updated",
    body: `${subject} classes for ${batch?.name ?? "your batch"} changed. Check this week's timetable.`,
    data: { tab: "home", kind: "timetable" },
  });
}
