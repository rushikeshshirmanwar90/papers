import { requireAdmin } from "@/lib/admin";
import { route } from "@/lib/http";
import Batch from "@/models/Batch";
import PracticeAnswer from "@/models/PracticeAnswer";
import TestAttempt from "@/models/TestAttempt";
import TestRoom from "@/models/TestRoom";
import Tuition from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

const DAY = 86400000;

/**
 * The whole network at a glance: totals, sign-ups over the last 30 days,
 * last week's activity, and the largest tuitions.
 */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const since30 = new Date(Date.now() - 30 * DAY);
  const since7 = new Date(Date.now() - 7 * DAY);

  const [tuitions, activeTuitions, roles, batches, tests, submitted, practice, signups, testsWeek, attemptsWeek, activeUsersWeek, biggest] = await Promise.all([
    Tuition.countDocuments(),
    Tuition.countDocuments({ active: true }),
    User.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$role", n: { $sum: 1 } } }]),
    Batch.countDocuments(),
    TestRoom.countDocuments(),
    TestAttempt.countDocuments({ submittedAt: { $ne: null } }),
    PracticeAnswer.countDocuments(),
    User.aggregate<{ _id: { day: string; role: string }; n: number }>([
      { $match: { createdAt: { $gte: since30 }, role: { $in: ["student", "teacher"] } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, role: "$role" }, n: { $sum: 1 } } },
    ]),
    TestRoom.countDocuments({ createdAt: { $gte: since7 } }),
    TestAttempt.countDocuments({ submittedAt: { $gte: since7 } }),
    User.countDocuments({ lastLoginAt: { $gte: since7 } }),
    User.aggregate<{ _id: unknown; students: number }>([
      { $match: { role: "student" } },
      { $group: { _id: "$tuitionId", students: { $sum: 1 } } },
      { $sort: { students: -1 } },
      { $limit: 5 },
    ]),
  ]);
  const roleCount = (r: string) => roles.find((x) => x._id === r)?.n ?? 0;
  const names = await Tuition.find({ _id: { $in: biggest.map((b) => b._id) } }).select("name active").lean<{ _id: unknown; name: string; active: boolean }[]>();

  // One entry per day, oldest first, including days with no sign-ups.
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() + 5.5 * 3600000 - (29 - i) * DAY).toISOString().slice(0, 10);
    const on = (role: string) => signups.find((s) => s._id.day === d && s._id.role === role)?.n ?? 0;
    return { day: d, students: on("student"), teachers: on("teacher") };
  });

  return {
    totals: {
      tuitions,
      activeTuitions,
      teachers: roleCount("teacher"),
      students: roleCount("student"),
      batches,
      tests,
      submittedTests: submitted,
      practiceAnswers: practice,
    },
    week: { testsSet: testsWeek, testsTaken: attemptsWeek, activeUsers: activeUsersWeek },
    signups: days,
    biggest: biggest.map((b) => {
      const t = names.find((n) => String(n._id) === String(b._id));
      return { id: String(b._id), name: t?.name ?? "Removed tuition", active: t?.active ?? false, students: b.students };
    }),
  };
});
