import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";
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
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  try {
    await connectDB();

    const scope = new URLSearchParams(searchParams);
    scope.delete("chapter");
    scope.delete("topic");
    scope.delete("level");
    scope.delete("difficulty");
    const chapterFilter = buildFilter(scope, "subject");

    const topicScope = new URLSearchParams(scope);
    const chapter = searchParams.get("chapter");
    if (chapter) topicScope.set("chapter", chapter);
    const topicFilter = buildFilter(topicScope, "subject");

    const [chapters, topics, subjects] = await Promise.all([
      Question.distinct("chapter", chapterFilter),
      Question.distinct("topic", topicFilter),
      Question.distinct("subject"),
    ]);

    return NextResponse.json({
      examCategories: EXAM_CATEGORIES,
      standards: STANDARDS,
      subjects: nonEmpty([...subjects, ...BASE_SUBJECTS]),
      chapters: nonEmpty(chapters),
      topics: nonEmpty(topics),
      levels: LEVELS,
    });
  } catch (err) {
    console.error("Fetch filters error:", err);
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}
