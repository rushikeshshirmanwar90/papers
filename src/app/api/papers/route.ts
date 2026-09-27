import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";

export async function GET(req: NextRequest) {
  await connectDB();
  const { searchParams } = new URL(req.url);

  const filter: Record<string, unknown> = {};

  const examCategory = searchParams.get("examCategory");
  if (examCategory && examCategory !== "All") {
    filter.examCategory = examCategory;
  }

  const standard = searchParams.get("standard");
  if (standard && standard !== "All") {
    filter.standard = standard;
  }

  const subject = searchParams.get("subject");
  if (subject && subject !== "All") {
    filter.subjects = subject;
  }

  const chapter = searchParams.get("chapter");
  if (chapter && chapter !== "All") {
    filter.chapter = { $regex: new RegExp(chapter, "i") };
  }

  const topic = searchParams.get("topic");
  if (topic && topic !== "All") {
    filter.topic = { $regex: new RegExp(topic, "i") };
  }

  const level = searchParams.get("difficulty") || searchParams.get("level");
  if (level && level !== "All") {
    filter.difficulty = level;
  }

  const papers = await Paper.find(filter).sort({ uploadedDate: -1 }).lean();

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
