import { Types } from "mongoose";
import { HttpError, route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { testFor } from "@/lib/tests";
import { combine, topicStatsByStudent } from "@/lib/topic-stats";
import TestAttempt from "@/models/TestAttempt";

export const dynamic = "force-dynamic";

/**
 * How a batch did on one test: the spread of scores, topic understanding
 * (accuracy per topic across everyone), and the questions most got wrong.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test } = await testFor(session, params.id);
  const attempts = await TestAttempt.find({ testId: test._id, submittedAt: { $ne: null } })
    .select("studentId score maxScore answers")
    .lean<{ studentId: Types.ObjectId; score: number; maxScore: number; answers: { index: number; selected: string | null; correct: boolean | null }[] }[]>();
  if (!test.questions.length) throw new HttpError(400, "This test has no questions.");

  const max = test.questions.length * test.marksPerQuestion;
  // Five bands of the maximum score: 0–20%, 20–40%, … 80–100%.
  const bands = [0, 1, 2, 3, 4].map((i) => ({ from: Math.round((max * i) / 5), to: Math.round((max * (i + 1)) / 5), students: 0 }));
  for (const a of attempts) {
    const share = max ? Math.max(0, a.score) / max : 0;
    bands[Math.min(4, Math.floor(share * 5))].students += 1;
  }

  const stats = await topicStatsByStudent(
    attempts.map((a) => a.studentId),
    { testIds: [test._id as Types.ObjectId] }
  );
  const topics = combine([...stats.values()]).sort((a, b) => a.accuracy - b.accuracy);

  const questions = test.questions
    .map((q, index) => {
      const answers = attempts.map((a) => a.answers.find((x) => x.index === index));
      const answered = answers.filter((x) => x && x.correct !== null).length;
      const right = answers.filter((x) => x?.correct === true).length;
      const choices: Record<string, number> = {};
      for (const x of answers) if (x?.selected) choices[x.selected] = (choices[x.selected] ?? 0) + 1;
      return {
        index,
        chapter: q.chapter,
        topic: q.topic,
        questionText: q.questionText,
        correctAnswer: q.correctAnswer,
        answered,
        skipped: attempts.length - answered,
        accuracy: answered ? Math.round((right / answered) * 100) : null,
        choices,
      };
    })
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));

  const scores = attempts.map((a) => a.score);
  return {
    submitted: attempts.length,
    maxScore: max,
    average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    highest: scores.length ? Math.max(...scores) : null,
    lowest: scores.length ? Math.min(...scores) : null,
    bands,
    topics,
    hardest: questions.filter((q) => q.accuracy !== null).slice(0, 5),
  };
});
