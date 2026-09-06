import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Attempt from "@/models/Attempt";
import Question from "@/models/Question";
import Paper from "@/models/Paper";
import { buildReview } from "@/lib/scoring";
import type { GivenAnswerDoc } from "@/models/Attempt";

// Re-renders a past attempt's full review, e.g. for the mobile app's
// "view review" link from the progress screen.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const attempt = await Attempt.findById(params.id).lean();
  if (!attempt) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

  const questions = await Question.find({ paperId: attempt.paperId }).sort({ questionNumber: 1 });
  const { review } = buildReview(
    questions,
    attempt.answers.map((a: GivenAnswerDoc) => ({ questionId: String(a.questionId), selected: a.selected }))
  );
  const paper = await Paper.findById(attempt.paperId).lean();

  return NextResponse.json({ ...attempt, review, paper });
}
