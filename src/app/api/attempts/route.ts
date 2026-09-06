import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";
import Attempt from "@/models/Attempt";
import Paper from "@/models/Paper";
import { buildReview, type GivenAnswerInput } from "@/lib/scoring";

// Scores an attempt server-side (students only ever see questions with the
// correct answer withheld) and returns the full answer review.
export async function POST(req: NextRequest) {
  await connectDB();
  const { studentId, paperId, answers, timeTaken } = (await req.json()) as {
    studentId: string;
    paperId: string;
    answers: GivenAnswerInput[];
    timeTaken?: number;
  };

  if (!studentId || !paperId || !Array.isArray(answers)) {
    return NextResponse.json({ error: "studentId, paperId and answers are required" }, { status: 400 });
  }

  const questions = await Question.find({ paperId }).sort({ questionNumber: 1 });
  const { review, score, correctCount, wrongCount, skippedCount, totalQuestions } = buildReview(
    questions,
    answers
  );

  const attempt = await Attempt.create({
    studentId,
    paperId,
    answers: answers.map((a) => ({ questionId: a.questionId, selected: a.selected ?? null })),
    score,
    correctCount,
    wrongCount,
    skippedCount,
    totalQuestions,
    timeTaken: timeTaken ?? 0,
  });

  const paper = await Paper.findById(paperId).lean();

  return NextResponse.json(
    {
      ...attempt.toObject(),
      review,
      paper,
    },
    { status: 201 }
  );
}