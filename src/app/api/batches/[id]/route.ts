import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { coverageFor } from "@/lib/syllabus";
import { batchFor, subjectsTaught } from "@/lib/teaching";
import { batchNames, batchOut, studentOut, teacherNames } from "@/lib/tuition";
import User, { type UserDoc } from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * A batch for anyone who may see it: its timings, teachers and syllabus
 * coverage; its students for the tuition and its teachers; and the subjects
 * the user teaches in it.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req);
  const batch = await batchFor(session, params.id);
  const seesStudents = session.role !== "student";
  const [students, names, batchNameMap, coverage] = await Promise.all([
    seesStudents
      ? (User.find({ tuitionId: session.tuitionId, role: "student", batchId: batch._id }).sort({ name: 1 }) as Promise<UserDoc[]>)
      : Promise.resolve([] as UserDoc[]),
    teacherNames(session.tuitionId),
    batchNames(session.tuitionId),
    coverageFor([batch]),
  ]);
  const studentCount = seesStudents ? students.length : await User.countDocuments({ tuitionId: session.tuitionId, role: "student", batchId: batch._id });
  return {
    batch: { ...batchOut(batch, names, studentCount), coverage: coverage.get(String(batch._id)) ?? {} },
    mySubjects: subjectsTaught(session, batch),
    students: students.map((s) => studentOut(s, batchNameMap)),
  };
});
