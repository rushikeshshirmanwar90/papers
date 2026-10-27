import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question, { NOT_A_BANK_COPY } from "@/models/Question";
import { buildFilter } from "@/lib/queryFilters";

// Chapters and topics grow with every upload. Without this, Next pre-renders
// the route at build time and keeps serving that (often empty) snapshot.
export const dynamic = "force-dynamic";

const EXAM_CATEGORIES = ["Foundation", "JEE/NEET"];
const STANDARDS = [
  { category: "Foundation", values: ["9th", "10th"] },
  { category: "JEE/NEET", values: ["11th", "12th"] },
];
const BASE_SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology", "Science"];
const LEVELS = ["Easy", "Mid", "Hard"];

const nonEmpty = (values: unknown[]) =>
  Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.trim() !== ""))).sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true })
  );

// Optional query params (examCategory, standard, subject, chapter) narrow the
// chapter and topic lists to what actually exists under that selection, so
// the apps' dropdowns only offer choices that return questions. Every
// question carries its paper's chapter/topic, so questions alone are enough.
//
// chapterCounts and topicCounts say how many questions each one holds, so a
// teacher can see where the questions are. They count what /api/questions
// returns by default, i.e. everything but Descriptive questions.
// chapterTopics lists each chapter's topics, for picking topics across
// several chapters; ?chapter may repeat to narrow topics to several.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  try {
    await connectDB();

    const scope = new URLSearchParams(searchParams);
    scope.delete("chapter");
    scope.delete("topic");
    scope.delete("level");
    scope.delete("difficulty");
    const chosenChapters = new Set(
      searchParams
        .getAll("chapter")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && value !== "all")
    );

    // One pass over the selection gives every chapter, every topic, and both counts.
    const [groups, subjects] = await Promise.all([
      Question.aggregate<{ _id: { chapter?: string; topic?: string }; count: number }>([
        { $match: { ...buildFilter(scope, "subject"), ...NOT_A_BANK_COPY } },
        {
          $group: {
            _id: { chapter: "$chapter", topic: "$topic" },
            count: { $sum: { $cond: [{ $eq: ["$answerType", "Descriptive"] }, 0, 1] } },
          },
        },
      ]),
      Question.distinct("subject"),
    ]);

    const chapterCounts: Record<string, number> = {};
    const topicCounts: Record<string, number> = {};
    const chapterTopics: Record<string, string[]> = {};
    for (const { _id, count } of groups) {
      const chapterName = _id.chapter?.trim();
      const topicName = _id.topic?.trim();
      if (chapterName) chapterCounts[chapterName] = (chapterCounts[chapterName] ?? 0) + count;
      if (chapterName && topicName) (chapterTopics[chapterName] ??= []).push(topicName);
      // Topics are narrowed to the chosen chapters, matched the way buildFilter matches them.
      if (topicName && (!chosenChapters.size || chosenChapters.has(chapterName?.toLowerCase() ?? ""))) {
        topicCounts[topicName] = (topicCounts[topicName] ?? 0) + count;
      }
    }
    for (const name of Object.keys(chapterTopics)) chapterTopics[name] = nonEmpty(chapterTopics[name]);

    return NextResponse.json({
      examCategories: EXAM_CATEGORIES,
      standards: STANDARDS,
      subjects: nonEmpty([...subjects, ...BASE_SUBJECTS]),
      chapters: nonEmpty(Object.keys(chapterCounts)),
      topics: nonEmpty(Object.keys(topicCounts)),
      chapterCounts,
      topicCounts,
      chapterTopics,
      levels: LEVELS,
    });
  } catch (err) {
    console.error("Fetch filters error:", err);
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}
