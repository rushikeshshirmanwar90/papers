import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { coverageFor } from "@/lib/syllabus";
import { batchOut, studentCounts, teacherNames } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * The tuition's home: how many students, teachers and batches it has, and
 * for each batch its students and how much of each subject it has covered.
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const [students, teachers, batches, counts, names] = await Promise.all([
    User.countDocuments({ tuitionId, role: "student" }),
    User.countDocuments({ tuitionId, role: "teacher" }),
    Batch.find({ tuitionId }).sort({ name: 1 }) as Promise<BatchDoc[]>,
    studentCounts(tuitionId),
    teacherNames(tuitionId),
  ]);
  const coverage = await coverageFor(batches);
  return {
    totals: {
      students,
      teachers,
      batches: batches.length,
      unassignedStudents: students - [...counts.values()].reduce((a, b) => a + b, 0),
    },
    batches: batches.map((b) => ({
      ...batchOut(b, names, counts.get(String(b._id)) ?? 0),
      coverage: coverage.get(String(b._id)) ?? {},
    })),
  };
});
