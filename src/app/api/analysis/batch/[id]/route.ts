import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { batchFor } from "@/lib/teaching";
import { combine, levelOf, topicStatsByStudent } from "@/lib/topic-stats";
import TestAttempt from "@/models/TestAttempt";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Student profile analysis, batch-wise: every student's average score,
 * tests taken, accuracy and strong/weak topic counts, and the batch's
 * weakest topics overall. For the tuition and the batch's teachers.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const batch = await batchFor(session, params.id);
  const students = await User.find({ tuitionId: session.tuitionId, role: "student", batchId: batch._id })
    .select("name")
    .sort({ name: 1 })
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const ids = students.map((s) => s._id);
  const [stats, attempts] = await Promise.all([
    topicStatsByStudent(ids),
    TestAttempt.find({ studentId: { $in: ids }, batchId: batch._id, submittedAt: { $ne: null } })
      .select("studentId score maxScore")
      .lean<{ studentId: Types.ObjectId; score: number; maxScore: number }[]>(),
  ]);

  const rows = students.map((s) => {
    const mine = stats.get(String(s._id)) ?? [];
    const tests = attempts.filter((a) => String(a.studentId) === String(s._id));
    const answered = mine.reduce((n, x) => n + x.answered, 0);
    const correct = mine.reduce((n, x) => n + x.correct, 0);
    return {
      student: { id: String(s._id), name: s.name },
      testsTaken: tests.length,
      averagePercent: tests.length ? Math.round(tests.reduce((n, a) => n + (a.maxScore ? (a.score / a.maxScore) * 100 : 0), 0) / tests.length) : null,
      accuracy: answered ? Math.round((correct / answered) * 100) : null,
      level: levelOf(answered, correct),
      strongTopics: mine.filter((x) => x.level === "strong").length,
      weakTopics: mine.filter((x) => x.level === "weak").length,
      weakest: mine.filter((x) => x.level === "weak").sort((a, b) => a.accuracy - b.accuracy).slice(0, 3).map((x) => x.topic || x.chapter),
    };
  });
  rows.sort((a, b) => (b.averagePercent ?? -1) - (a.averagePercent ?? -1) || a.student.name.localeCompare(b.student.name));

  const batchTopics = combine([...stats.values()]).filter((t) => t.level !== "not-enough");
  return {
    batch: { id: String(batch._id), name: batch.name },
    students: rows,
    weakTopics: batchTopics.filter((t) => t.level === "weak").sort((a, b) => a.accuracy - b.accuracy).slice(0, 10),
    strongTopics: batchTopics.filter((t) => t.level === "strong").sort((a, b) => b.accuracy - a.accuracy).slice(0, 10),
  };
});
