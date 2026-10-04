import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";
import { buildFilter } from "@/lib/queryFilters";

export const dynamic = "force-dynamic";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const filter = buildFilter(searchParams, "subject");
    const search = searchParams.get("search")?.trim();
    const year = searchParams.get("year")?.trim();

    if (year && !/^\d{4}$/.test(year)) {
      return NextResponse.json({ error: "Year must be a four-digit year" }, { status: 400 });
    }

    if (search) {
      const searchPattern = new RegExp(escapeRegex(search), "i");
      filter.$or = [
        { questionText: searchPattern },
        { chapter: searchPattern },
        { topic: searchPattern },
        { optionA: searchPattern },
        { optionB: searchPattern },
        { optionC: searchPattern },
        { optionD: searchPattern },
        { explanation: searchPattern },
        { source: searchPattern },
      ];
    }
    if (year) {
      filter.source = { $regex: new RegExp(`\\b${year}\\b`, "i") };
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
