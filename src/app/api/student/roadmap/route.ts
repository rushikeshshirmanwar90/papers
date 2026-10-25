import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { badRequest, oneOf, route } from "@/lib/http";
import { SUBJECTS, SUBJECTS_BY_TRACK } from "@/lib/school";
import { syllabusFor } from "@/lib/syllabus";
import { levelOf, topicStatsByStudent } from "@/lib/topic-stats";
import ChapterWeightage from "@/models/ChapterWeightage";
import SyllabusProgress from "@/models/SyllabusProgress";

export const dynamic = "force-dynamic";

const low = (s: string) => s.toLowerCase();

/**
 * A student's roadmap for one subject (?subject=Physics): every chapter of 11th
 * and 12th with the marks the tuition says it carries, what the tuition has
 * covered, and the student's strong and weak topics.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const { user } = session;
  const track = user.track ?? "General";
  const subject = oneOf({ subject: req.nextUrl.searchParams.get("subject") }, "subject", SUBJECTS, "a subject");
  if (!SUBJECTS_BY_TRACK[track].includes(subject)) throw badRequest(`${subject} isn't part of the ${track} track.`);

  const [syllabus, weights, progress, stats] = await Promise.all([
    syllabusFor(subject),
    ChapterWeightage.find({ tuitionId: session.tuitionId, track, subject }).lean<{ standard: string; chapter: string; marks: number }[]>(),
    user.batchId
      ? SyllabusProgress.find({ batchId: user.batchId, subject }).lean<{ standard: string; chapter: string; topic: string; coveredOn: Date }[]>()
      : Promise.resolve([]),
    topicStatsByStudent([user._id as Types.ObjectId]),
  ]);
  const mine = (stats.get(String(user._id)) ?? []).filter((s) => s.subject === subject);

  const chapters = syllabus.map((c) => {
    const covered = progress.filter((p) => p.standard === c.standard && low(p.chapter) === low(c.chapter));
    const chapterStats = mine.filter((s) => low(s.chapter) === low(c.chapter));
    const answered = chapterStats.reduce((n, s) => n + s.answered, 0);
    const correct = chapterStats.reduce((n, s) => n + s.correct, 0);
    const topics = c.topics.map((topic) => {
      const stat = chapterStats.find((s) => low(s.topic) === low(topic));
      const done = covered.find((p) => low(p.topic) === low(topic));
      return {
        topic,
        coveredOn: done?.coveredOn ?? null,
        answered: stat?.answered ?? 0,
        accuracy: stat?.accuracy ?? null,
        level: stat?.level ?? "not-enough",
      };
    });
    return {
      standard: c.standard,
      chapter: c.chapter,
      marks: weights.find((w) => w.standard === c.standard && low(w.chapter) === low(c.chapter))?.marks ?? null,
      topics,
      coveredTopics: topics.filter((t) => t.coveredOn).length,
      answered,
      accuracy: answered ? Math.round((correct / answered) * 100) : null,
      level: levelOf(answered, correct),
      strong: topics.filter((t) => t.level === "strong").map((t) => t.topic || c.chapter),
      weak: topics.filter((t) => t.level === "weak").map((t) => t.topic || c.chapter),
    };
  });

  const totalTopics = chapters.reduce((n, c) => n + c.topics.length, 0);
  const coveredTopics = chapters.reduce((n, c) => n + c.coveredTopics, 0);
  return {
    subject,
    track,
    standard: user.standard ?? null,
    hasBatch: !!user.batchId,
    summary: {
      totalMarks: chapters.reduce((n, c) => n + (c.marks ?? 0), 0),
      coveredPercent: totalTopics ? Math.round((coveredTopics / totalTopics) * 100) : 0,
      coveredTopics,
      totalTopics,
      strongTopics: chapters.reduce((n, c) => n + c.strong.length, 0),
      weakTopics: chapters.reduce((n, c) => n + c.weak.length, 0),
    },
    chapters,
  };
});
