import { requireUser } from "@/lib/auth";
import { HttpError, isObjectId, notFound, readJson, route } from "@/lib/http";
import { cleanAnswer, isCorrect } from "@/lib/marking";
import { practiceBankOf, pyqBankFilter } from "@/lib/pyq";
import { schoolSubjectOf } from "@/lib/topic-stats";
import PracticeAnswer from "@/models/PracticeAnswer";
import Question from "@/models/Question";

export const dynamic = "force-dynamic";

/**
 * Checks a practice answer: { questionId, selected }. Returns whether it's
 * right, the answer and the solution; a student's answer is kept for their
 * strong and weak topics and topic practice (one record per student and
 * question: the latest try counts, so sending the same answer again changes
 * nothing). `saved` says whether it was kept. Only past-year questions of the
 * user's program's bank can be checked (none for programs without a bank);
 * the student is always the one logged in.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req);
  const body = await readJson(req);
  const bank = practiceBankOf(session.user);
  if (!bank || !isObjectId(body.questionId)) throw notFound("This question");
  const q = await Question.findOne({ _id: body.questionId, ...pyqBankFilter(bank) })
    .select("subject standard chapter topic answerType correctAnswer explanation explanationDiagramUrls")
    .lean<{ subject: string; standard: string; chapter: string; topic: string; answerType: string; correctAnswer: string; explanation: string; explanationDiagramUrls: string[] }>();
  if (!q) throw notFound("This question");

  const selected = cleanAnswer(q, body.selected);
  if (selected === null) throw new HttpError(400, q.answerType === "Numerical" ? "Enter your answer." : "Pick an option.");
  const correct = isCorrect(q, selected);
  if (correct === null) throw new HttpError(400, "This question has no answer key to check against.");

  const saved = session.role === "student";
  if (saved) {
    await PracticeAnswer.updateOne(
      { studentId: session.user._id, questionId: body.questionId },
      {
        $set: {
          tuitionId: session.tuitionId,
          subject: schoolSubjectOf(q.subject),
          standard: q.standard,
          chapter: q.chapter,
          topic: q.topic,
          selected,
          correct,
          answeredAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
  return { correct, selected, saved, correctAnswer: q.correctAnswer, explanation: q.explanation, explanationDiagramUrls: q.explanationDiagramUrls ?? [] };
});
