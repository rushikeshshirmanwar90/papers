import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { programOf, programSubjects } from "@/lib/school";
import { coverageFor } from "@/lib/syllabus";
import { todayInIndia } from "@/lib/teaching";
import { testSummaries } from "@/lib/tests";
import { entriesOut } from "@/lib/timetable";
import { topicStatsByStudent } from "@/lib/topic-stats";
import { batchOut, teacherNames } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import SyllabusProgress from "@/models/SyllabusProgress";
import TestAttempt from "@/models/TestAttempt";
import TestRoom, { type TestRoomDoc } from "@/models/TestRoom";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";
import JoinRequest from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * A student's home: their batch and its syllabus coverage, today's classes
 * and the week's timetable, topics covered lately, open tests, their latest
 * result, and their strongest and weakest topics.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const { user } = session;
  const subjects = programSubjects(programOf(user));
  const batch = user.batchId ? ((await Batch.findOne({ _id: user.batchId, tuitionId: session.tuitionId })) as BatchDoc | null) : null;

  const [stats, attempts] = await Promise.all([
    topicStatsByStudent([user._id as Types.ObjectId]),
    TestAttempt.find({ studentId: user._id, submittedAt: { $ne: null } }).sort({ submittedAt: -1 }).limit(20).lean<{ testId: Types.ObjectId; score: number; maxScore: number; submittedAt: Date }[]>(),
  ]);
  // Marks only show once the test has closed.
  const closedTests = await TestRoom.find({ _id: { $in: attempts.map((a) => a.testId) }, closesAt: { $lte: new Date() } }).select("title").lean<{ _id: Types.ObjectId; title: string }[]>();
  const lastAttempt = attempts.find((a) => closedTests.some((t) => String(t._id) === String(a.testId)));
  const myStats = (stats.get(String(user._id)) ?? []).filter((s) => s.level !== "not-enough");
  const lastTest = lastAttempt ? closedTests.find((t) => String(t._id) === String(lastAttempt.testId)) : null;
  const insight = {
    weak: myStats.filter((s) => s.level === "weak").sort((a, b) => a.accuracy - b.accuracy).slice(0, 5),
    strong: myStats.filter((s) => s.level === "strong").sort((a, b) => b.accuracy - a.accuracy).slice(0, 5),
    lastResult: lastAttempt ? { title: lastTest?.title ?? "Test", score: lastAttempt.score, maxScore: lastAttempt.maxScore, submittedAt: lastAttempt.submittedAt } : null,
  };

  if (!batch) {
    // Check for pending enrollment requests to show the right state on the student home.
    const pendingRequest = await JoinRequest.findOne({ userId: user._id, tuitionId: session.tuitionId, status: "pending" })
      .select("batchId")
      .lean<{ batchId: Types.ObjectId | null } | null>();
    let enrollmentStatus: "enrolled" | "approval_pending" | "batch_pending" | null = null;
    let pendingBatchName: string | null = null;
    if (pendingRequest) {
      if (pendingRequest.batchId) {
        enrollmentStatus = "approval_pending";
        const pb = await Batch.findById(pendingRequest.batchId).select("name").lean<{ name: string }>();
        pendingBatchName = pb?.name ?? null;
      } else {
        enrollmentStatus = "batch_pending";
      }
    }
    return { subjects, batch: null, today: [], week: [], recent: [], openTests: [], insight, enrollmentStatus, pendingBatchName };
  }

  const { day } = todayInIndia();
  const [names, count, coverage, classes, recent, open] = await Promise.all([
    teacherNames(session.tuitionId),
    User.countDocuments({ tuitionId: session.tuitionId, role: "student", batchId: batch._id }),
    coverageFor([batch]),
    TimetableEntry.find({ batchId: batch._id }).sort({ day: 1, start: 1 }) as Promise<TimetableEntryDoc[]>,
    SyllabusProgress.find({ batchId: batch._id }).sort({ coveredOn: -1, createdAt: -1 }).limit(8).lean<{ _id: Types.ObjectId; subject: string; chapter: string; topic: string; coveredOn: Date }[]>(),
    TestRoom.find({ batchId: batch._id, opensAt: { $lte: new Date() }, $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] })
      .select("-questions.explanation")
      .sort({ opensAt: -1 }) as Promise<TestRoomDoc[]>,
  ]);
  const done = await TestAttempt.find({ studentId: user._id, testId: { $in: open.map((t) => t._id) }, submittedAt: { $ne: null } })
    .select("testId")
    .lean<{ testId: Types.ObjectId }[]>();
  const pending = open.filter((t) => !done.some((d) => String(d.testId) === String(t._id)));
  const week = await entriesOut(session, classes);

  return {
    subjects,
    batch: { ...batchOut(batch, names, count), coverage: coverage.get(String(batch._id)) ?? {} },
    today: week.filter((c) => c.day === day),
    week,
    recent: recent.map((r) => ({ id: String(r._id), subject: r.subject, chapter: r.chapter, topic: r.topic, coveredOn: r.coveredOn })),
    openTests: await testSummaries(pending),
    insight,
  };
});
