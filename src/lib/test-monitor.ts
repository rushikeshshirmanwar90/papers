import type { Types } from "mongoose";
import { deadlineOf, finalizeExpired } from "@/lib/attempts";
import { statusOf } from "@/lib/tests";
import TestAttempt from "@/models/TestAttempt";
import type { TestRoomDoc } from "@/models/TestRoom";
import User from "@/models/User";

// Live monitoring for teachers: who has not started, who is answering, who has
// finished. Read-only apart from scoring attempts whose time is up (the same
// rule the results list applies). Nothing here touches questions or answer keys:
// only how many questions are answered, never which answer was chosen.

export type MonitorState = "not-started" | "in-progress" | "submitted" | "auto-submitted" | "violation";

/** One attempt as the monitor needs it: no answer content, only how many are filled in. */
export interface MonitorAttempt {
  studentId: Types.ObjectId;
  startedAt: Date;
  submittedAt: Date | null;
  endedReason: "violation" | null;
  answered: number;
}

/**
 * Where a student is, from their attempt and the server's deadline for it.
 * - no attempt: not started
 * - ended by the app-switch rule: violation
 * - submitted before the deadline: submitted
 * - submitted at the deadline, or still unsubmitted after it (time ran out or the
 *   test was closed; scoring happens on the next touch): auto-submitted
 * - otherwise: in progress
 * finalize() stamps an expired attempt with exactly its deadline, and a student's own
 * submit always lands before it, so the two can be told apart without a new field.
 */
export function stateOf(test: Pick<TestRoomDoc, "durationMinutes" | "closesAt">, attempt: Pick<MonitorAttempt, "startedAt" | "submittedAt" | "endedReason"> | undefined, now = Date.now()): MonitorState {
  if (!attempt) return "not-started";
  if (attempt.endedReason === "violation") return "violation";
  const deadline = deadlineOf(test as TestRoomDoc, attempt).getTime();
  if (attempt.submittedAt) return attempt.submittedAt.getTime() >= deadline ? "auto-submitted" : "submitted";
  return now >= deadline ? "auto-submitted" : "in-progress";
}

export interface MonitorRow {
  student: { id: string; name: string };
  state: MonitorState;
  answered: number;
  total: number;
  startedAt: Date | null;
  submittedAt: Date | null;
  /** Seconds left on the server's deadline; only while in progress. */
  remainingSeconds: number | null;
}

export interface MonitorCounts {
  /** Approved students of the test's batch. total = notStarted + inProgress + submitted. */
  total: number;
  notStarted: number;
  inProgress: number;
  /** Every finalized attempt, including the two kinds below. */
  submitted: number;
  autoSubmitted: number;
  violations: number;
}

/** Rows and counts from the batch's students and their attempts. Pure, so it can be tested without a database. */
export function buildMonitor(
  test: Pick<TestRoomDoc, "durationMinutes" | "closesAt"> & { questions: { length: number } },
  students: { _id: Types.ObjectId; name: string }[],
  attempts: MonitorAttempt[],
  now = Date.now()
) {
  const byStudent = new Map(attempts.map((a) => [String(a.studentId), a]));
  const counts: MonitorCounts = { total: students.length, notStarted: 0, inProgress: 0, submitted: 0, autoSubmitted: 0, violations: 0 };
  const total = test.questions.length;
  const rows: MonitorRow[] = students.map((s) => {
    const a = byStudent.get(String(s._id));
    const state = stateOf(test, a, now);
    if (state === "not-started") counts.notStarted++;
    else if (state === "in-progress") counts.inProgress++;
    else {
      counts.submitted++;
      if (state === "auto-submitted") counts.autoSubmitted++;
      if (state === "violation") counts.violations++;
    }
    const deadline = a ? deadlineOf(test as TestRoomDoc, a) : null;
    return {
      student: { id: String(s._id), name: s.name },
      state,
      answered: Math.min(a?.answered ?? 0, total),
      total,
      startedAt: a?.startedAt ?? null,
      // An expired attempt not yet scored will be stamped with its deadline when it is.
      submittedAt: a ? (a.submittedAt ?? (state === "auto-submitted" ? deadline : null)) : null,
      remainingSeconds: state === "in-progress" && deadline ? Math.max(0, Math.floor((deadline.getTime() - now) / 1000)) : null,
    };
  });
  // Needs attention first, then by name.
  const rank: Record<MonitorState, number> = { "in-progress": 0, violation: 1, "not-started": 2, "auto-submitted": 3, submitted: 4 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || a.student.name.localeCompare(b.student.name));
  return { counts, rows };
}

/**
 * The monitor for a test. Students are the tuition's students enrolled in the
 * test's batch (a student only has a batch once their request was approved);
 * attempts are read in one aggregation with the answers reduced to a count.
 */
export async function monitorTest(test: TestRoomDoc) {
  const [batchStudents, attempts] = await Promise.all([
    User.find({ tuitionId: test.tuitionId, role: "student", batchId: test.batchId }).select("name active").lean<{ _id: Types.ObjectId; name: string; active?: boolean }[]>(),
    TestAttempt.aggregate<MonitorAttempt>([
      // An attempt is only ever made for the test's own tuition and batch, so one that disagrees is not counted.
      { $match: { testId: test._id, tuitionId: test.tuitionId, batchId: test.batchId } },
      {
        $project: {
          studentId: 1,
          startedAt: 1,
          submittedAt: 1,
          endedReason: 1,
          // `$gt: null` is false for a skipped (null) or missing answer, true for any given one.
          answered: { $size: { $filter: { input: { $ifNull: ["$answers", []] }, as: "a", cond: { $gt: ["$$a.selected", null] } } } },
        },
      },
    ]),
  ]);
  // A turned-off account can't take the test, so it isn't "eligible" unless it already has an attempt.
  // Limitation: batch membership is only known as of now (there is no enrollment history). A student who
  // joined the batch after the test closed shows as "not started" on it, though they were never eligible.
  // Attempts of people no longer in the batch are not counted, so the numbers add up.
  const attempted = new Set(attempts.map((a) => String(a.studentId)));
  const inBatch = new Set(batchStudents.map((s) => String(s._id)));
  // Someone who took the test and was then moved to another batch of this tuition still counts,
  // as they do in the test's submitted total. (Someone removed from the tuition does not.)
  const moved = [...attempted].filter((id) => !inBatch.has(id));
  const movedStudents = moved.length
    ? await User.find({ _id: { $in: moved }, tuitionId: test.tuitionId, role: "student" }).select("name active").lean<{ _id: Types.ObjectId; name: string; active?: boolean }[]>()
    : [];
  const students = [...batchStudents, ...movedStudents].filter((s) => s.active !== false || attempted.has(String(s._id)));
  const now = Date.now();
  const { counts, rows } = buildMonitor(test, students, attempts, now);

  // Score attempts whose time is up, as the results list does, so the stored data catches up
  // with what is shown. A failure here must not hide the monitor: those rows already read as ended.
  if (attempts.some((a) => !a.submittedAt && now >= deadlineOf(test, a).getTime())) {
    await finalizeExpired(test).catch((error) => console.error("[monitor] couldn't score expired attempts:", error));
  }

  return {
    status: statusOf(test, now),
    serverTime: new Date(now),
    counts,
    students: rows,
  };
}
