import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { coverageFor } from "@/lib/syllabus";
import { todayInIndia } from "@/lib/teaching";
import { entriesOut } from "@/lib/timetable";
import { batchOut, studentCounts, teacherNames } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";

export const dynamic = "force-dynamic";

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/**
 * A teacher's home and profile numbers: the batches they teach (with the
 * subjects they teach in each), today's classes, and their weekly hours.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "teacher");
  const me = session.user._id as Types.ObjectId;
  const [batches, counts, names, myClasses] = await Promise.all([
    Batch.find({ tuitionId: session.tuitionId, "teachers.teacherId": me }).sort({ name: 1 }) as Promise<BatchDoc[]>,
    studentCounts(session.tuitionId),
    teacherNames(session.tuitionId),
    TimetableEntry.find({ tuitionId: session.tuitionId, teacherId: me }).sort({ day: 1, start: 1 }) as Promise<TimetableEntryDoc[]>,
  ]);
  const coverage = await coverageFor(batches);
  const { day } = todayInIndia();
  const today = myClasses.filter((c) => c.day === day);

  return {
    totals: {
      batches: batches.length,
      students: batches.reduce((sum, b) => sum + (counts.get(String(b._id)) ?? 0), 0),
      weeklyMinutes: myClasses.reduce((sum, c) => sum + minutes(c.end) - minutes(c.start), 0),
      classesThisWeek: myClasses.length,
    },
    batches: batches.map((b) => ({
      ...batchOut(b, names, counts.get(String(b._id)) ?? 0),
      mySubjects: b.teachers.filter((t) => String(t.teacherId) === session.userId).map((t) => t.subject),
      coverage: coverage.get(String(b._id)) ?? {},
    })),
    today: await entriesOut(session, today),
    week: await entriesOut(session, myClasses),
  };
});
