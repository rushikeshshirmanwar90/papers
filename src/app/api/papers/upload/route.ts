import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { HttpError, badRequest, oneOf, readBody, route, text } from "@/lib/http";
import { enumOf, requireBankAdmin } from "@/lib/question-bank";
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

export const runtime = "nodejs";
// Parsing a 15-page paper (fonts, images, geometry) can outlast the default
// serverless limit; 60s is the ceiling on Vercel's hobby plan.
export const maxDuration = 60;

/**
 * The largest PDF accepted: the PDF is kept in one Mongo document, which
 * can't pass 16 MB. (Vercel itself refuses request bodies over 4.5 MB.)
 */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** Room for the form's other fields and multipart framing. */
const MAX_BODY_BYTES = MAX_PDF_BYTES + 64 * 1024;
const TOO_LARGE = `The PDF is too large (at most ${MAX_PDF_BYTES / 1024 / 1024} MB).`;
const tooLarge = () => new HttpError(413, TOO_LARGE);
/** Extraction is heavy: at most this many uploads run at once in one server process. */
const MAX_RUNNING = 2;
let running = 0;

/** The form, read with a byte limit so an oversized body is cut off, with or without a Content-Length. */
async function readForm(req: NextRequest): Promise<FormData> {
  const body = await readBody(req, MAX_BODY_BYTES, TOO_LARGE);
  try {
    return await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw badRequest("Send the paper as multipart/form-data with the PDF in the field \"pdf\".");
  }
}

/** The upload's file and details, each checked before any extraction starts. */
async function readUpload(req: NextRequest) {
  const formData = await readForm(req);
  const fields = Object.fromEntries([...formData.entries()].filter(([name]) => name !== "pdf"));
  const choice = (name: string, allowed: string[], fallback: string) => (text(fields, name) ? oneOf(fields, name, allowed) : fallback);

  const file = formData.get("pdf");
  if (!file || !(file instanceof File)) throw badRequest("PDF file is required (field name: pdf)");
  if (file.size > MAX_PDF_BYTES) throw tooLarge();
  if (file.size === 0) throw badRequest("The PDF is empty.");
  const buffer = Buffer.from(await file.arrayBuffer());
  // A real PDF starts with "%PDF-" (readers allow it within the first 1 KB),
  // whatever the file's name or type claim.
  if (!buffer.subarray(0, 1024).includes("%PDF-")) throw badRequest("Only PDF files are supported");

  const thisYear = new Date().getFullYear();
  const yearRaw = text(fields, "year");
  const year = yearRaw ? Number(yearRaw) : thisYear;
  if (!Number.isInteger(year) || year < 1950 || year > thisYear + 1) throw badRequest(`year must be a year from 1950 to ${thisYear + 1}.`);

  return {
    file,
    buffer,
    title: text(fields, "title") ?? "",
    examType: choice("examType", enumOf(Paper, "examType"), "JEE"),
    examCategory: choice("examCategory", enumOf(Paper, "examCategory"), "JEE/NEET"),
    standard: choice("standard", enumOf(Paper, "standard"), "11th"),
    // Stored on every question too, so it must suit the Question model.
    difficulty: choice("difficulty", enumOf(Question, "difficulty"), "Medium"),
    subject: choice("subject", enumOf(Question, "subject"), ""),
    chapter: text(fields, "chapter") ?? "",
    topic: text(fields, "topic") ?? "",
    year,
  };
}

export const POST = route(async (req) => {
  // Who and how big are checked before the body is read.
  await requireBankAdmin(req);
  // A declared oversize is refused before taking an upload slot; readBody cuts off the rest.
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw tooLarge();
  if (running >= MAX_RUNNING) throw new HttpError(429, "Other papers are being processed. Try again in a minute.");

  running++;
  try {
    return await processUpload(await readUpload(req));
  } finally {
    running--;
  }
});

async function processUpload({
  file,
  buffer,
  title,
  examType,
  examCategory,
  standard,
  subject,
  chapter,
  topic,
  difficulty,
  year,
}: Awaited<ReturnType<typeof readUpload>>) {
  // The paper's id is fixed up front so the PDF and every diagram can be
  // stored against it before the Paper document itself exists.
  const paperId = new Types.ObjectId();
  try {
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
      examCategory,
      standard,
      chapter,
      topic,
      difficulty,
      year,
      subjects: subjectsFound.length > 0 ? subjectsFound : (subject ? [subject] : ["Physics"]),
      totalQuestions: questions.length,
      pdfUrl,
    });

    const questionDocs = await Question.insertMany(
      questionRecords.map((q) => ({
        ...q,
        paperId: paper._id,
        examCategory: q.examCategory || examCategory,
        standard: q.standard || standard,
        chapter: q.chapter || chapter,
        topic: q.topic || topic,
        difficulty: q.difficulty || difficulty,
        subject: q.subject || subject || "Physics",
      }))
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
    // Undo whatever this upload stored (all of it is under its new paper id),
    // then let route() log the error and answer with a plain 500.
    await Promise.allSettled([
      Question.deleteMany({ paperId }),
      Paper.deleteOne({ _id: paperId }),
      deleteFilesForPaper(paperId),
    ]);
    throw err;
  }
}
