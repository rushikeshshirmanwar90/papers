import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import { buildFilter } from "@/lib/queryFilters";

// Database-backed results must be read at request time, not during a build.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await connectDB();
  const { searchParams } = new URL(req.url);

  const filter = buildFilter(searchParams, "subjects");

  const papers = await Paper.find(filter).sort({ uploadedDate: -1 }).lean();

  // One grouping for every paper rather than one query per paper: with the
  // whole question bank loaded there are thousands of papers. It reads only
  // the { paperId, subject } index.
  const breakdown = await Question.aggregate([
    { $match: { paperId: { $in: papers.map((p) => p._id) } } },
    { $group: { _id: { paperId: "$paperId", subject: "$subject" }, count: { $sum: 1 } } },
  ]);
  const byPaper = new Map<string, { subject: string; count: number }[]>();
  for (const b of breakdown) {
    const key = String(b._id.paperId);
    if (!byPaper.has(key)) byPaper.set(key, []);
    byPaper.get(key)!.push({ subject: b._id.subject, count: b.count });
  }

  return NextResponse.json(
    papers.map((paper) => ({ ...paper, subjectBreakdown: byPaper.get(String(paper._id)) ?? [] }))
  );
}
