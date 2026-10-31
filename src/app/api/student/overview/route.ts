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

  const [stats, lastAttempt] = await Promise.all([
    topicStatsByStudent([user._id as Types.ObjectId]),
    TestAttempt.findOne({ studentId: user._id, submittedAt: { $ne: null } }).sort({ submittedAt: -1 }).lean<{ testId: Types.ObjectId; score: number; maxScore: number; submittedAt: Date }>(),
  ]);
  const myStats = (stats.get(String(user._id)) ?? []).filter((s) => s.level !== "not-enough");
  const lastTest = lastAttempt ? await TestRoom.findById(lastAttempt.testId).select("title").lean<{ title: string }>() : null;
  const insight = {
    weak: myStats.filter((s) => s.level === "weak").sort((a, b) => a.accuracy - b.accuracy).slice(0, 5),
    strong: myStats.filter((s) => s.level === "strong").sort((a, b) => b.accuracy - a.accuracy).slice(0, 5),
    lastResult: lastAttempt ? { title: lastTest?.title ?? "Test", score: lastAttempt.score, maxScore: lastAttempt.maxScore, submittedAt: lastAttempt.submittedAt } : null,
  };

  if (!batch) return { subjects, batch: null, today: [], week: [], recent: [], openTests: [], insight };

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
