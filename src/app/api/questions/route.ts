import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
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
      filter.subject = subject;
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

    const paperId = searchParams.get("paperId");
    if (paperId) {
      filter.paperId = paperId;
    }

    const questions = await Question.find(filter).sort({ questionNumber: 1 }).lean();

    return NextResponse.json({
      success: true,
      count: questions.length,
      questions,
    });
  } catch (err) {
    console.error("Fetch questions error:", err);
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 });
  }
}
