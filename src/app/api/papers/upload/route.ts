import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import { extractLinesFromPdf } from "@/lib/pdfText";
import { parseQuestionsFromLines } from "@/lib/questionParser";
import { extractStructuredPdf } from "@/lib/pdfStructured";
import { parseCoachingPaper } from "@/lib/coachingPaperParser";
import { saveDiagrams } from "@/lib/saveDiagrams";
import { deleteFilesForPaper, saveFile } from "@/lib/storage";
import { extractTexPdf } from "@/lib/pdfTex";
import { formatTexExplanation, stripAnswerMarker, tidyProse } from "@/lib/texExplanation";
import type { ExamType } from "@shared/types";

export const runtime = "nodejs";
// Parsing a 15-page paper (fonts, images, geometry) can outlast the default
// serverless limit; 60s is the ceiling on Vercel's hobby plan.
export const maxDuration = 60;

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

    // The paper's id is fixed up front so the PDF and every diagram can be
    // stored against it before the Paper document itself exists.
    const paperId = new Types.ObjectId();
    await connectDB();
    const pdfUrl = await saveFile(buffer, {
      filename: file.name,
      contentType: "application/pdf",
      kind: "pdf",
      paperId,
    });

    // Strict single-column "1. / (A) / Ans. [X]" layout first; if that finds
    // nothing, fall back to the tolerant multi-column coaching-paper parser,
    // which also picks up worked explanations and diagram images.
    const lines = await extractLinesFromPdf(buffer);
    let { questions, subjectsFound } = parseQuestionsFromLines(lines);
    let questionRecords: Record<string, unknown>[] = questions.map((q) => ({ ...q }));

    if (questions.length === 0) {
      // TeX-typeset papers (Computer Modern fonts) go through the geometry
      // reconstruction, which rebuilds every fraction, root and exponent as
      // LaTeX; anything else uses the plain text-row extractor.
      const tex = await extractTexPdf(buffer);
      const events = tex.isTex ? tex.events : await extractStructuredPdf(buffer);
      const fallback = parseCoachingPaper(events);
      if (tex.isTex) {
        for (const q of fallback.questions) {
          q.questionText = tidyProse(q.questionText);
          q.optionA = tidyProse(q.optionA);
          q.optionB = tidyProse(q.optionB);
          q.optionC = tidyProse(q.optionC);
          q.optionD = tidyProse(q.optionD);
          const { answer, text } = stripAnswerMarker(q.explanation);
          q.explanation = formatTexExplanation(text);
          if (!q.correctAnswer && answer) q.correctAnswer = answer;
        }
      }
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
          saveDiagrams(q.diagrams, paperId),
          saveDiagrams(q.optionDiagrams.A, paperId),
          saveDiagrams(q.optionDiagrams.B, paperId),
          saveDiagrams(q.optionDiagrams.C, paperId),
          saveDiagrams(q.optionDiagrams.D, paperId),
          saveDiagrams(q.explanationDiagrams, paperId),
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
      await deleteFilesForPaper(paperId).catch(() => {});
      return NextResponse.json(
        {
          error:
            "No questions could be extracted from this PDF. Check that it follows the expected format (numbered questions, (A)-(D) options, 'Ans. [X]' answers).",
        },
        { status: 422 }
      );
    }

    const paper = await Paper.create({
      _id: paperId,
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
    const detail = err instanceof Error ? err.message : "";
    return NextResponse.json(
      { error: detail ? `Failed to process PDF upload: ${detail}` : "Failed to process PDF upload" },
      { status: 500 }
    );
  }
}
