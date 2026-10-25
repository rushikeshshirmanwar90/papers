import { Types } from "mongoose";
import type { Session } from "@/lib/auth";
import { HttpError, badRequest, isObjectId, oneOf, text } from "@/lib/http";
import { SUBJECTS } from "@/lib/school";
import { batchFor, mustTeach } from "@/lib/teaching";
import { readSchedule } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";
import User from "@/models/User";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Reads and checks a class's fields, for a new class or an edit. */
export async function readEntry(session: Session, body: Record<string, unknown>, existing?: TimetableEntryDoc) {
  const batch: BatchDoc = await batchFor(session, body.batchId ?? existing?.batchId);
  const subject = body.subject !== undefined ? oneOf(body, "subject", SUBJECTS, "a subject") : existing!.subject;
  mustTeach(session, batch, subject);

  // The slot reuses the batch timing checks: a day, and a start before the end.
  const [slot] = readSchedule([{ day: body.day ?? existing?.day, start: body.start ?? existing?.start, end: body.end ?? existing?.end }]);

  let teacherId: Types.ObjectId;
  if (session.role === "teacher") teacherId = session.user._id as Types.ObjectId;
  else {
    const given = body.teacherId ?? batch.teachers.find((t) => t.subject === subject)?.teacherId ?? existing?.teacherId;
    if (!isObjectId(String(given ?? ""))) throw badRequest(`Assign a ${subject} teacher to ${batch.name} first.`);
    if (!(await User.exists({ _id: given, tuitionId: session.tuitionId, role: "teacher" }))) throw badRequest("Pick one of your teachers.");
    teacherId = new Types.ObjectId(String(given));
  }

  const note = body.note !== undefined ? text(body, "note", { max: 200 }) ?? "" : existing?.note ?? "";
  return { batch, fields: { tuitionId: batch.tuitionId, batchId: batch._id, teacherId, subject, ...slot, note } };
}

/** Throws 409 when the class overlaps another of the batch's or the teacher's. */
export async function checkClashes(fields: { tuitionId: Types.ObjectId; batchId: Types.ObjectId; teacherId: Types.ObjectId; day: number; start: string; end: string }, exceptId?: Types.ObjectId) {
  const sameDay = await TimetableEntry.find({
    tuitionId: fields.tuitionId,
    day: fields.day,
    $or: [{ batchId: fields.batchId }, { teacherId: fields.teacherId }],
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).lean<{ batchId: Types.ObjectId; teacherId: Types.ObjectId; subject: string; start: string; end: string }[]>();
  const clash = sameDay.find((e) => minutes(e.start) < minutes(fields.end) && minutes(fields.start) < minutes(e.end));
  if (clash) {
    const who = String(clash.batchId) === String(fields.batchId) ? "this batch's" : "the teacher's";
    throw new HttpError(409, `This clashes with ${who} ${clash.subject} class on ${WEEKDAYS[fields.day]}, ${clash.start}–${clash.end}.`);
  }
}

/** Classes as the app shows them: batch, teacher and whether it's the user's own. */
export async function entriesOut(session: Session, entries: TimetableEntryDoc[]) {
  const [batches, teachers] = await Promise.all([
    Batch.find({ _id: { $in: entries.map((e) => e.batchId) } }).select("name venue").lean<{ _id: Types.ObjectId; name: string; venue: string }[]>(),
    User.find({ _id: { $in: entries.map((e) => e.teacherId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  return entries.map((e) => {
    const batch = batches.find((b) => String(b._id) === String(e.batchId));
    return {
      id: String(e._id),
      batch: { id: String(e.batchId), name: batch?.name ?? "", venue: batch?.venue ?? "" },
      teacher: { id: String(e.teacherId), name: teachers.find((t) => String(t._id) === String(e.teacherId))?.name ?? "" },
      subject: e.subject,
      day: e.day,
      start: e.start,
      end: e.end,
      note: e.note,
      mine: String(e.teacherId) === session.userId,
    };
  });
}
