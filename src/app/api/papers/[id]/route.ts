import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import Attempt from "@/models/Attempt";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const paper = await Paper.findById(params.id).lean();
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  const questions = await Question.find({ paperId: params.id }).sort({ questionNumber: 1 }).lean();

  return NextResponse.json({ paper, questions });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const paper = await Paper.findByIdAndDelete(params.id);
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  await Question.deleteMany({ paperId: params.id });
  await Attempt.deleteMany({ paperId: params.id });

  return NextResponse.json({ success: true });
}
