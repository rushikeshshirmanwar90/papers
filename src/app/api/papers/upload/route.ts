import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import { extractLinesFromPdf } from "@/lib/pdfText";
import { parseQuestionsFromLines } from "@/lib/questionParser";
import { extractStructuredPdf } from "@/lib/pdfStructured";
import { parseCoachingPaper } from "@/lib/coachingPaperParser";
import { saveDiagrams } from "@/lib/saveDiagrams";
import type { ExamType } from "@shared/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("pdf");
    const title = (formData.get("title") as string) || "";
    const examType = (formData.get("examType") as ExamType) || "JEE";
    const yearRaw = formData.get("year") as string;
    const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "PDF file is required (field name: pdf)" }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.pdf`;
    await writeFile(path.join(uploadsDir, fileName), buffer);
    const pdfUrl = `/uploads/${fileName}`;

    // Strict single-column "1. / (A) / Ans. [X]" layout first; if that finds
    // nothing, fall back to the tolerant multi-column coaching-paper parser,
    // which also picks up worked explanations and diagram images.
    const lines = await extractLinesFromPdf(buffer);
    let { questions, subjectsFound } = parseQuestionsFromLines(lines);
    let questionRecords: Record<string, unknown>[] = questions.map((q) => ({ ...q }));

    if (questions.length === 0) {
      const events = await extractStructuredPdf(buffer);
      const fallback = parseCoachingPaper(events);
      questions = fallback.questions.map((q) => ({
        questionNumber: q.questionNumber,
        subject: q.subject,
        section: q.section,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctAnswer: q.correctAnswer,
        answerType: q.answerType,
      }));
      subjectsFound = fallback.subjectsFound;
      questionRecords = [];
      for (const q of fallback.questions) {
        const [diagramUrls, optionA, optionB, optionC, optionD, explanationUrls] = await Promise.all([
          saveDiagrams(q.diagrams),
          saveDiagrams(q.optionDiagrams.A),
          saveDiagrams(q.optionDiagrams.B),
          saveDiagrams(q.optionDiagrams.C),
          saveDiagrams(q.optionDiagrams.D),
          saveDiagrams(q.explanationDiagrams),
        ]);
        questionRecords.push({
          questionNumber: q.questionNumber,
          subject: q.subject,
          section: q.section,
          questionText: q.questionText,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctAnswer: q.correctAnswer,
          answerType: q.answerType,
          explanation: q.explanation,
          diagramUrls,
          explanationDiagramUrls: explanationUrls,
          optionDiagramUrls: { A: optionA, B: optionB, C: optionC, D: optionD },
        });
      }
    }

    if (questions.length === 0) {
      return NextResponse.json(
        {
          error:
            "No questions could be extracted from this PDF. Check that it follows the expected format (numbered questions, (A)-(D) options, 'Ans. [X]' answers).",
        },
        { status: 422 }
      );
    }

    await connectDB();

    const paper = await Paper.create({
      title: title || file.name.replace(/\.pdf$/i, ""),
      examType,
      year,
      subjects: subjectsFound,
      totalQuestions: questions.length,
      pdfUrl,
    });

    const questionDocs = await Question.insertMany(
      questionRecords.map((q) => ({ ...q, paperId: paper._id }))
    );

    return NextResponse.json(
      {
        paper,
        questionCount: questionDocs.length,
        subjectsFound,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Upload/parse error:", err);
    return NextResponse.json({ error: "Failed to process PDF upload" }, { status: 500 });
  }
}
