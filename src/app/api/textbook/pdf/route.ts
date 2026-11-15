import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Textbook from "@/models/Textbook";
import { PDFDocument } from "pdf-lib";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChapterItem {
  chapterNumber: number;
  name: string;
  slug?: string;
  pdfPath?: string;
  marks?: number;
  pages?: number;
}

const normalize = (val: string) => val.trim().toLowerCase().replace(/[^\w\s-]/g, "");

function matchChapter(ch: ChapterItem, target: string): boolean {
  const t = target.trim();
  const num = parseInt(t, 10);
  if (!isNaN(num) && ch.chapterNumber === num) return true;
  const tNorm = normalize(t);
  const nameNorm = normalize(ch.name);
  if (ch.slug && ch.slug.toLowerCase() === tNorm) return true;
  return nameNorm.includes(tNorm) || tNorm.includes(nameNorm);
}

/**
 * Resolves local file system path for a textbook PDF
 */
function resolvePdfPath(relativePath: string): string {
  const rootDir = path.resolve(process.cwd(), "..");
  const possiblePaths = [
    path.join(rootDir, "extractor", "output", "ncert_books", relativePath),
    path.join(rootDir, "extractor", "output", relativePath),
    path.join(process.cwd(), "public", relativePath),
    path.join(rootDir, relativePath),
    relativePath,
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }
  return path.join(rootDir, "extractor", "output", "ncert_books", relativePath);
}

/**
 * GET /api/textbook/pdf
 *
 * Query Parameters:
 *  - standard / class: "11th" | "12th"
 *  - subject: "Physics" | "Chemistry" | "Mathematics" | "Biology"
 *  - chapter / chapterNumber: single chapter number or name (e.g. "1")
 *  - chapters: comma-separated list of chapter numbers or names (e.g. "1,2,3")
 *  - download: boolean ("true" to trigger download attachment)
 */
export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const standardParam = (searchParams.get("standard") || searchParams.get("class") || "").trim();
    const subjectParam = (searchParams.get("subject") || "").trim();
    const chapterParam = (searchParams.get("chapter") || searchParams.get("chapterNumber") || "").trim();
    const chaptersParam = (searchParams.get("chapters") || searchParams.get("chapterNumbers") || "").trim();
    const download = searchParams.get("download") === "true";

    if (!standardParam || !subjectParam) {
      return NextResponse.json({
        ok: false,
        error: "Missing required parameters: 'standard' and 'subject'.",
      }, { status: 400 });
    }

    let standard = standardParam;
    if (/11/i.test(standardParam)) standard = "11th";
    if (/12/i.test(standardParam)) standard = "12th";

    const textbook = await Textbook.findOne({
      standard,
      subject: new RegExp(`^${subjectParam}$`, "i"),
    }).lean<{ standard: string; subject: string; chapters: ChapterItem[] }>();

    if (!textbook) {
      return NextResponse.json({
        ok: false,
        error: `Textbook not found for standard ${standard} and subject ${subjectParam}.`,
      }, { status: 404 });
    }

    const targetChapters: string[] = [];
    if (chapterParam) targetChapters.push(chapterParam);
    if (chaptersParam) {
      targetChapters.push(...chaptersParam.split(",").map((s) => s.trim()).filter(Boolean));
    }

    let selectedChapters: ChapterItem[] = textbook.chapters;
    if (targetChapters.length > 0) {
      selectedChapters = textbook.chapters.filter((ch) =>
        targetChapters.some((tc) => matchChapter(ch, tc))
      );
    }

    if (selectedChapters.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No chapters matched the provided filter.",
        targetChapters,
      }, { status: 404 });
    }

    selectedChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    // If single chapter requested and only 1 chapter matched
    if (selectedChapters.length === 1) {
      const ch = selectedChapters[0];
      const filePath = resolvePdfPath(ch.pdfPath || "");
      try {
        const fileBuffer = await fs.readFile(filePath);
        const fileName = `${subjectParam}_Class${standard.replace(/\D/g, "")}_Ch${ch.chapterNumber}_${normalize(ch.name)}.pdf`;
        const disposition = download ? `attachment; filename="${fileName}"` : `inline; filename="${fileName}"`;

        return new NextResponse(fileBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": disposition,
            "Content-Length": String(fileBuffer.length),
            "X-Chapter-Number": String(ch.chapterNumber),
            "X-Chapter-Marks": String(ch.marks ?? 5),
          },
        });
      } catch (err) {
        return NextResponse.json({
          ok: false,
          error: `Chapter PDF file not found on disk: ${filePath}`,
        }, { status: 404 });
      }
    }

    // Multiple chapters: Merge with pdf-lib
    const mergedPdf = await PDFDocument.create();
    let mergedCount = 0;

    for (const ch of selectedChapters) {
      if (!ch.pdfPath) continue;
      const filePath = resolvePdfPath(ch.pdfPath);
      try {
        const pdfBytes = await fs.readFile(filePath);
        const srcDoc = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        mergedCount++;
      } catch (e) {
        // Skip or continue if one chapter file is missing
      }
    }

    if (mergedCount === 0) {
      return NextResponse.json({
        ok: false,
        error: "None of the selected chapter PDF files could be found on disk.",
      }, { status: 404 });
    }

    const mergedBytes = await mergedPdf.save();
    const chNumbersStr = selectedChapters.map((c) => c.chapterNumber).join("-");
    const fileName = `${subjectParam}_Class${standard.replace(/\D/g, "")}_Chapters_${chNumbersStr}.pdf`;
    const disposition = download ? `attachment; filename="${fileName}"` : `inline; filename="${fileName}"`;

    return new NextResponse(Buffer.from(mergedBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Content-Length": String(mergedBytes.length),
        "X-Total-Chapters": String(mergedCount),
        "X-Total-Marks": String(selectedChapters.reduce((sum, c) => sum + (c.marks ?? 5), 0)),
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal Server Error",
    }, { status: 500 });
  }
}
