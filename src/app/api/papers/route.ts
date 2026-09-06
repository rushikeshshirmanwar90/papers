import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";

export async function GET() {
  await connectDB();

  const papers = await Paper.find().sort({ uploadedDate: -1 }).lean();

  const papersWithBreakdown = await Promise.all(
    papers.map(async (paper) => {
      const breakdown = await Question.aggregate([
        { $match: { paperId: paper._id } },
        { $group: { _id: "$subject", count: { $sum: 1 } } },
      ]);
      return {
        ...paper,
        subjectBreakdown: breakdown.map((b) => ({ subject: b._id, count: b.count })),
      };
    })
  );

  return NextResponse.json(papersWithBreakdown);
}
