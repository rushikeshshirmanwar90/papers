import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";

const EDITABLE_FIELDS = [
  "subject",
  "section",
  "questionText",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "correctAnswer",
  "answerType",
  "difficulty",
  "questionNumber",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const body = await req.json();

  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }

  const question = await Question.findByIdAndUpdate(params.id, update, {
    new: true,
    runValidators: true,
  });

  if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  return NextResponse.json(question);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const question = await Question.findByIdAndDelete(params.id);
  if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
