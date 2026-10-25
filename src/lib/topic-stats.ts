import type { Types } from "mongoose";
import PracticeAnswer from "@/models/PracticeAnswer";
import TestAttempt from "@/models/TestAttempt";
import TestRoom from "@/models/TestRoom";

// How well students understand each topic, from every answer they've given:
// submitted tests and PYQ practice. Skipped questions don't count.

/** A topic needs this many answers before it's called strong or weak. */
export const MIN_ANSWERS = 3;
export const STRONG_FROM = 70; // % correct
export const WEAK_BELOW = 40; // % correct

export type Level = "strong" | "average" | "weak" | "not-enough";

export interface TopicStat {
  subject: string;
  chapter: string;
  topic: string;
  answered: number;
  correct: number;
  accuracy: number;
  level: Level;
}

export function levelOf(answered: number, correct: number): Level {
  if (answered < MIN_ANSWERS) return "not-enough";
  const accuracy = (correct / answered) * 100;
  if (accuracy >= STRONG_FROM) return "strong";
  if (accuracy < WEAK_BELOW) return "weak";
  return "average";
}

const finish = (subject: string, chapter: string, topic: string, answered: number, correct: number): TopicStat => ({
  subject,
  chapter,
  topic,
  answered,
  correct,
  accuracy: answered ? Math.round((correct / answered) * 100) : 0,
  level: levelOf(answered, correct),
});

type Tally = Map<string, { subject: string; chapter: string; topic: string; answered: number; correct: number }>;

function add(tally: Tally, bankSubject: string, chapter: string, topic: string, correct: boolean) {
  if (!chapter) return;
  const subject = schoolSubjectOf(bankSubject);
  const key = `${subject}|${chapter.toLowerCase()}|${topic.toLowerCase()}`;
  const entry = tally.get(key) ?? { subject, chapter, topic, answered: 0, correct: 0 };
  entry.answered += 1;
  if (correct) entry.correct += 1;
  tally.set(key, entry);
}

/**
 * Each student's accuracy per topic. With testIds, only those tests count
 * (and no practice), e.g. for one test's analysis.
 */
export async function topicStatsByStudent(
  studentIds: Types.ObjectId[],
  { testIds, includePractice = true }: { testIds?: Types.ObjectId[]; includePractice?: boolean } = {}
): Promise<Map<string, TopicStat[]>> {
  const attempts = await TestAttempt.find({
    studentId: { $in: studentIds },
    submittedAt: { $ne: null },
    ...(testIds ? { testId: { $in: testIds } } : {}),
  })
    .select("studentId testId answers")
    .lean<{ studentId: Types.ObjectId; testId: Types.ObjectId; answers: { index: number; correct: boolean | null }[] }[]>();

  const tests = await TestRoom.find({ _id: { $in: [...new Set(attempts.map((a) => String(a.testId)))] } })
    .select("questions.subject questions.chapter questions.topic")
    .lean<{ _id: Types.ObjectId; questions: { subject: string; chapter: string; topic: string }[] }[]>();
  const questionsOf = new Map(tests.map((t) => [String(t._id), t.questions]));

  const tallies = new Map<string, Tally>();
  const tallyOf = (id: Types.ObjectId) => {
    const key = String(id);
    if (!tallies.has(key)) tallies.set(key, new Map());
    return tallies.get(key)!;
  };

  for (const attempt of attempts) {
    const questions = questionsOf.get(String(attempt.testId)) ?? [];
    for (const answer of attempt.answers) {
      const q = questions[answer.index];
      if (!q || answer.correct === null) continue;
      add(tallyOf(attempt.studentId), q.subject, q.chapter, q.topic, answer.correct);
    }
  }

  if (includePractice && !testIds) {
    const practice = await PracticeAnswer.find({ studentId: { $in: studentIds } })
      .select("studentId subject chapter topic correct")
      .lean<{ studentId: Types.ObjectId; subject: string; chapter: string; topic: string; correct: boolean }[]>();
    for (const p of practice) add(tallyOf(p.studentId), p.subject, p.chapter, p.topic, p.correct);
  }

  const result = new Map<string, TopicStat[]>();
  for (const id of studentIds) {
    const tally = tallies.get(String(id)) ?? new Map();
    result.set(
      String(id),
      [...tally.values()].map((t) => finish(t.subject, t.chapter, t.topic, t.answered, t.correct))
    );
  }
  return result;
}

/** Adds topics up to their chapters (and across students when given several lists). */
export function byChapter(stats: TopicStat[]): TopicStat[] {
  const tally: Tally = new Map();
  for (const s of stats) {
    const key = `${s.subject}|${s.chapter.toLowerCase()}`;
    const entry = tally.get(key) ?? { subject: s.subject, chapter: s.chapter, topic: "", answered: 0, correct: 0 };
    entry.answered += s.answered;
    entry.correct += s.correct;
    tally.set(key, entry);
  }
  return [...tally.values()].map((t) => finish(t.subject, t.chapter, "", t.answered, t.correct));
}

/** Topics added up across several students, e.g. a batch's understanding. */
export function combine(lists: TopicStat[][]): TopicStat[] {
  const tally: Tally = new Map();
  for (const s of lists.flat()) {
    const key = `${s.subject}|${s.chapter.toLowerCase()}|${s.topic.toLowerCase()}`;
    const entry = tally.get(key) ?? { subject: s.subject, chapter: s.chapter, topic: s.topic, answered: 0, correct: 0 };
    entry.answered += s.answered;
    entry.correct += s.correct;
    tally.set(key, entry);
  }
  return [...tally.values()].map((t) => finish(t.subject, t.chapter, t.topic, t.answered, t.correct));
}

/** Bank subjects (Botany, Zoology) under the school subject the app shows. */
export function schoolSubjectOf(subject: string): string {
  return subject === "Botany" || subject === "Zoology" ? "Biology" : subject;
}
