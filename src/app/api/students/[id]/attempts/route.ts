import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Attempt from "@/models/Attempt";
import Paper from "@/models/Paper";

// A student's past attempts/progress, most recent first, with paper titles attached.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();

  const attempts = await Attempt.find({ studentId: params.id }).sort({ attemptedDate: -1 }).lean();
  const paperIds = [...new Set(attempts.map((a) => String(a.paperId)))];
  const papers = await Paper.find({ _id: { $in: paperIds } }).lean();
  const paperMap = new Map(papers.map((p) => [String(p._id), p]));

  const enriched = attempts.map((a) => ({
    ...a,
    paper: paperMap.get(String(a.paperId)) ?? null,
  }));

  return NextResponse.json(enriched);
}
