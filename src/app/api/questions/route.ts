import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";
import { buildFilter } from "@/lib/queryFilters";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const filter = buildFilter(searchParams, "subject");

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
