import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";

// Used by the mobile app when a student starts attempting a paper.
// The correct answer — and the worked explanation, which states it — are
// withheld until the attempt is submitted.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const paper = await Paper.findById(params.id).lean();
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  const questions = await Question.find({ paperId: params.id })
    .sort({ questionNumber: 1 })
    .select("-correctAnswer -explanation -explanationDiagramUrls")
    .lean();

  return NextResponse.json({ paper, questions });
}
