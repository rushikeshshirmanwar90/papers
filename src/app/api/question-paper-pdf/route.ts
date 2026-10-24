import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { embedFigures } from "@/lib/questionPaper/figures";
import { figureUrlsOf, questionPaperHtml } from "@/lib/questionPaper/html";
import { PaperRequestError, parsePaper } from "@/lib/questionPaper/parse";
import { renderPdf } from "@/lib/questionPaper/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 300-question paper with solutions prints in about 5 s on a laptop; this
// leaves room for a cold start and a slower function.
export const maxDuration = 120;

const CHUNK_BYTES = 256 * 1024;

/** The PDF as a stream: Vercel caps buffered responses at 4.5 MB, streamed ones aren't. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

/**
 * Makes a printable question paper. The pcmb-paper app posts the picked
 * questions (with any edits the teacher made) and gets the PDF back.
 * Phones used to print it themselves, and Android's print engine could stall
 * on a long paper full of maths.
 */
export async function POST(req: NextRequest) {
  let paper;
  try {
    paper = parsePaper(await req.json());
  } catch (error) {
    const message = error instanceof PaperRequestError ? error.message : "Send the paper as JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const started = Date.now();
    const figures = await embedFigures(figureUrlsOf(paper), req.headers.get("host") ?? "");
    const figuresDone = Date.now();
    const pdf = await renderPdf(questionPaperHtml(paper, figures));
    const pages = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
    const done = Date.now();
    console.log(
      `[question-paper-pdf] ${paper.questions.length} questions, ${figures.size} figures, ${pages} pages, ` +
        `${Math.round(pdf.length / 1024)} KB: figures ${figuresDone - started} ms, print ${done - figuresDone} ms`
    );

    const filename = `${paper.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.pdf`;
    return new Response(streamOf(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Page-Count": String(pages),
        "X-Render-Ms": String(done - started),
      },
    });
  } catch (error) {
    console.error("[question-paper-pdf] failed:", error);
    return NextResponse.json({ error: "Could not make the PDF. Try again." }, { status: 500 });
  }
}
