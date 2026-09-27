import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Question from "@/models/Question";
import Paper from "@/models/Paper";

export async function GET() {
  try {
    await connectDB();

    const [questionChapters, questionTopics, questionSubjects, paperChapters, paperTopics] = await Promise.all([
      Question.distinct("chapter"),
      Question.distinct("topic"),
      Question.distinct("subject"),
      Paper.distinct("chapter"),
      Paper.distinct("topic"),
    ]);

    const chapters = Array.from(
      new Set([...questionChapters, ...paperChapters].filter(Boolean))
    );
    const topics = Array.from(
      new Set([...questionTopics, ...paperTopics].filter(Boolean))
    );
    const subjects = Array.from(
      new Set([...questionSubjects, "Physics", "Chemistry", "Mathematics", "Biology", "Science"].filter(Boolean))
    );

    return NextResponse.json({
      examCategories: ["Foundation", "JEE/NEET"],
      standards: [
        { category: "Foundation", values: ["9th", "10th"] },
        { category: "JEE/NEET", values: ["11th", "12th"] },
      ],
      subjects,
      chapters,
      topics,
      levels: ["Easy", "Mid", "Hard"],
    });
  } catch (err) {
    console.error("Fetch filters error:", err);
    return NextResponse.json(
      {
        examCategories: ["Foundation", "JEE/NEET"],
        standards: [
          { category: "Foundation", values: ["9th", "10th"] },
          { category: "JEE/NEET", values: ["11th", "12th"] },
        ],
        subjects: ["Physics", "Chemistry", "Mathematics", "Biology", "Science"],
        chapters: ["Kinematics", "Real Numbers", "Laws of Motion", "Trigonometry", "Cell Structure"],
        topics: ["Relative Motion", "Polynomials", "Newton's Laws", "Trigonometric Ratios", "Cell Organelles"],
        levels: ["Easy", "Mid", "Hard"],
      },
      { status: 200 }
    );
  }
}
