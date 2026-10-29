import type { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { answersOf, chapterKey, low, pyqGroups, statsOf, topicKey } from "@/lib/practice";
import { pyqFilter, readSubject } from "@/lib/pyq";
import { syllabusFor } from "@/lib/syllabus";
import Question from "@/models/Question";
import SyllabusProgress from "@/models/SyllabusProgress";

export const dynamic = "force-dynamic";

type Tally = Map<string, { questions: number; answered: number; correct: number }>;

const bump = (tally: Tally, key: string, field: "questions" | "answered" | "correct", by = 1) => {
  const entry = tally.get(key) ?? { questions: 0, answered: 0, correct: 0 };
  entry[field] += by;
  tally.set(key, entry);
};

/**
 * Topic practice for one subject (?subject=Physics): the student's syllabus
 * (the same chapters and topics as the Syllabus tab, with what their batch
 * has covered), and for each chapter and topic how many past-year questions
 * there are and how the student has done on them. No questions are sent.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const { user } = session;
  const track = user.track ?? "General";
  const subject = readSubject(req.nextUrl.searchParams.get("subject"), track);

  const [syllabus, groups, progress, answers] = await Promise.all([
    syllabusFor(subject),
    pyqGroups(track, subject),
    user.batchId
      ? SyllabusProgress.find({ batchId: user.batchId, subject }).select("standard chapter topic coveredOn").lean<{ standard: string; chapter: string; topic: string; coveredOn: Date }[]>()
      : Promise.resolve([]),
    answersOf(user._id as Types.ObjectId, subject),
  ]);

  // Where each answered question sits now (its current chapter and topic),
  // counting only questions that are still the track's PYQs.
  const answered = answers.size
    ? await Question.find({ ...pyqFilter(track, subject), _id: { $in: [...answers.values()].map((a) => a.questionId) } })
        .select("standard chapter topic")
        .lean<{ _id: Types.ObjectId; standard: string; chapter: string; topic: string }[]>()
    : [];

  const byChapter: Tally = new Map();
  const byTopic: Tally = new Map();
  for (const g of groups) {
    bump(byChapter, chapterKey(g.standard, g.chapter), "questions", g.questions);
    bump(byTopic, topicKey(g.standard, g.chapter, g.topic), "questions", g.questions);
  }
  for (const q of answered) {
    const right = answers.get(String(q._id))?.correct ? 1 : 0;
    for (const [tally, key] of [
      [byChapter, chapterKey(q.standard, q.chapter)],
      [byTopic, topicKey(q.standard, q.chapter, q.topic ?? "")],
    ] as const) {
      bump(tally, key, "answered");
      bump(tally, key, "correct", right);
    }
  }
  const statsFor = (tally: Tally, key: string) => {
    const t = tally.get(key);
    return statsOf(t?.questions ?? 0, t?.answered ?? 0, t?.correct ?? 0);
  };

  const chapters = syllabus.map((c) => {
    const covered = progress.filter((p) => p.standard === c.standard && low(p.chapter) === low(c.chapter));
    const coveredOn = (topic: string) => covered.find((p) => low(p.topic) === low(topic))?.coveredOn ?? null;
    // A chapter without named topics is practised as a whole (the syllabus lists it as topic "").
    const named = c.topics.filter((t) => t !== "");
    const topics = named.map((topic) => ({ topic, coveredOn: coveredOn(topic), ...statsFor(byTopic, topicKey(c.standard, c.chapter, topic)) }));
    const chapter = statsFor(byChapter, chapterKey(c.standard, c.chapter));
    return {
      standard: c.standard,
      chapter: c.chapter,
      mine: user.standard === c.standard,
      coveredOn: named.length ? null : coveredOn(""),
      coveredTopics: named.length ? topics.filter((t) => t.coveredOn).length : coveredOn("") ? 1 : 0,
      totalTopics: named.length || 1,
      ...chapter,
      // Questions with this chapter but none of its topics: only "All chapter questions" has them.
      untagged: named.length ? Math.max(0, chapter.questions - topics.reduce((n, t) => n + t.questions, 0)) : 0,
      topics,
    };
  });

  const sum = (field: "questions" | "answered" | "correct") => chapters.reduce((n, c) => n + c[field], 0);
  return {
    subject,
    track,
    standard: user.standard ?? null,
    hasBatch: !!user.batchId,
    summary: {
      ...statsOf(sum("questions"), sum("answered"), sum("correct")),
      coveredTopics: chapters.reduce((n, c) => n + c.coveredTopics, 0),
      totalTopics: chapters.reduce((n, c) => n + c.totalTopics, 0),
    },
    chapters,
  };
});
