import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question, { NOT_A_BANK_COPY } from "@/models/Question";
import { buildFilter } from "@/lib/queryFilters";

export const dynamic = "force-dynamic";

// Page size: the question bank holds hundreds of thousands of questions, and
// an unbounded "everything" response would be hundreds of megabytes.
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

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
    } else {
      // Across the bank, a past paper's copy of a bank question would list it twice.
      Object.assign(filter, NOT_A_BANK_COPY);
    }

    // Descriptive questions have no options to pick from, so practice and
    // exam screens only get them on request: ?answerType=Descriptive for
    // just those, ?answerType=all for everything.
    const answerType = searchParams.get("answerType")?.trim();
    if (!answerType) filter.answerType = { $ne: "Descriptive" };
    else if (answerType !== "all") filter.answerType = answerType;

    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "", 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(parseInt(searchParams.get("page") ?? "", 10) || 1, 1);

    const [questions, total] = await Promise.all([
      Question.find(filter)
        .sort({ paperId: 1, questionNumber: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Question.countDocuments(filter),
    ]);

    return NextResponse.json({
      success: true,
      count: questions.length,
      total,
      page,
      limit,
      questions,
    });
  } catch (err) {
    console.error("Fetch questions error:", err);
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 });
  }
}
