import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { isObjectId, notFound, route } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { byChapter, topicStatsByStudent } from "@/lib/topic-stats";
import Batch from "@/models/Batch";
import TestAttempt from "@/models/TestAttempt";
import TestRoom from "@/models/TestRoom";
import User, { type UserDoc } from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * A student's profile analysis: accuracy per subject, chapter and topic,
 * their strong and weak topics, and every test they've taken. For the
 * tuition, the student's teachers, and the student themselves.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req);
  if (!isObjectId(params.id)) throw notFound("This student");
  const student = (await User.findOne({ _id: params.id, tuitionId: session.tuitionId, role: "student" })) as UserDoc | null;
  if (!student) throw notFound("This student");
  if (session.role === "student" && session.userId !== params.id) throw notFound("This student");
  if (session.role === "teacher") {
    const mine = await batchIdsOf(session);
    if (mine !== "all" && !mine.some((id) => String(id) === String(student.batchId))) throw notFound("This student");
  }

  const id = student._id as Types.ObjectId;
  const [statsMap, attempts, batch] = await Promise.all([
    topicStatsByStudent([id]),
    TestAttempt.find({ studentId: id, submittedAt: { $ne: null } })
      .sort({ submittedAt: -1 })
      .lean<{ testId: Types.ObjectId; score: number; maxScore: number; correctCount: number; wrongCount: number; skippedCount: number; submittedAt: Date }[]>(),
    student.batchId ? Batch.findById(student.batchId).select("name").lean<{ name: string }>() : null,
  ]);
  const stats = statsMap.get(String(id)) ?? [];
  const tests = await TestRoom.find({ _id: { $in: attempts.map((a) => a.testId) } }).select("title subject").lean<{ _id: Types.ObjectId; title: string; subject: string }[]>();

  const subjects = [...new Set(stats.map((s) => s.subject))].sort().map((subject) => {
    const topics = stats.filter((s) => s.subject === subject);
    const answered = topics.reduce((n, s) => n + s.answered, 0);
    const correct = topics.reduce((n, s) => n + s.correct, 0);
    return {
      subject,
      answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
      chapters: byChapter(topics).sort((a, b) => a.accuracy - b.accuracy),
    };
  });
  const percent = (a: { score: number; maxScore: number }) => (a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0);

  return {
    student: { id: String(id), name: student.name, track: student.track ?? null, standard: student.standard ?? null, batch: batch?.name ?? null },
    summary: {
      testsTaken: attempts.length,
      averagePercent: attempts.length ? Math.round(attempts.reduce((n, a) => n + percent(a), 0) / attempts.length) : null,
      answered: stats.reduce((n, s) => n + s.answered, 0),
      accuracy: (() => {
        const answered = stats.reduce((n, s) => n + s.answered, 0);
        return answered ? Math.round((stats.reduce((n, s) => n + s.correct, 0) / answered) * 100) : null;
      })(),
    },
    strong: stats.filter((s) => s.level === "strong").sort((a, b) => b.accuracy - a.accuracy),
    weak: stats.filter((s) => s.level === "weak").sort((a, b) => a.accuracy - b.accuracy),
    subjects,
    tests: attempts.map((a) => {
      const t = tests.find((x) => String(x._id) === String(a.testId));
      return {
        testId: String(a.testId),
        title: t?.title ?? "Deleted test",
        subject: t?.subject ?? "",
        score: a.score,
        maxScore: a.maxScore,
        percent: percent(a),
        correct: a.correctCount,
        wrong: a.wrongCount,
        skipped: a.skippedCount,
        submittedAt: a.submittedAt,
      };
    }),
  };
});
