import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import Attempt from "@/models/Attempt";
import Student from "@/models/Student";

export async function GET() {
  await connectDB();

  const [totalPapers, totalQuestions, totalAttempts, totalStudents, byExamType] = await Promise.all([
    Paper.countDocuments(),
    Question.countDocuments(),
    Attempt.countDocuments(),
    Student.countDocuments(),
    Paper.aggregate([{ $group: { _id: "$examType", count: { $sum: 1 } } }]),
  ]);

  return NextResponse.json({
    totalPapers,
    totalQuestions,
    totalAttempts,
    totalStudents,
    papersByExamType: byExamType.map((e) => ({ examType: e._id, count: e.count })),
  });
}
