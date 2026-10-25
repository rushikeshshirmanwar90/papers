import type { Session } from "@/lib/auth";
import { HttpError, isObjectId, notFound } from "@/lib/http";
import type { SchoolSubject } from "@/lib/school";
import Batch, { type BatchDoc } from "@/models/Batch";

// Who may see and change a batch's teaching data (syllabus progress,
// timetable, tests): the tuition for any of its batches, a teacher for the
// batches (and subjects) they teach, a student for their own batch (read only).

/** The batch, if the user may see it; 404 otherwise (so others' batches aren't revealed). */
export async function batchFor(session: Session, rawId: unknown): Promise<BatchDoc> {
  // A stored reference (ObjectId) or an id from a request (string).
  const id = rawId !== null && typeof rawId === "object" ? String(rawId) : rawId;
  if (!isObjectId(id)) throw notFound("This batch");
  const batch = (await Batch.findOne({ _id: id, tuitionId: session.tuitionId })) as BatchDoc | null;
  if (!batch) throw notFound("This batch");
  if (session.role === "teacher" && !batch.teachers.some((t) => String(t.teacherId) === session.userId)) throw notFound("This batch");
  if (session.role === "student" && String(session.user.batchId) !== String(batch._id)) throw notFound("This batch");
  return batch;
}

/** The subjects the user teaches in this batch: all of them for the tuition. */
export function subjectsTaught(session: Session, batch: BatchDoc): SchoolSubject[] {
  if (session.role === "tuition") return batch.subjects;
  if (session.role === "teacher") return batch.teachers.filter((t) => String(t.teacherId) === session.userId).map((t) => t.subject);
  return [];
}

/** Throws 403 unless the user teaches this subject in the batch (or is the tuition). */
export function mustTeach(session: Session, batch: BatchDoc, subject: SchoolSubject) {
  if (!batch.subjects.includes(subject)) throw new HttpError(400, `${subject} isn't one of ${batch.name}'s subjects.`);
  if (!subjectsTaught(session, batch).includes(subject)) throw new HttpError(403, `You don't teach ${subject} to ${batch.name}.`);
}

/** Today's weekday (0 = Sunday) in India, where the tuitions are. */
export function todayInIndia(): { day: number; date: string } {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { day: now.getUTCDay(), date: now.toISOString().slice(0, 10) };
}
