import { PDFDocument } from "pdf-lib";
import { requireUser } from "@/lib/auth";
import { HttpError, badRequest, readBody, route } from "@/lib/http";
import { embedFigures } from "@/lib/questionPaper/figures";
import { figureUrlsOf, questionPaperHtml, type QuestionPaper } from "@/lib/questionPaper/html";
import { PaperRequestError, parsePaper } from "@/lib/questionPaper/parse";
import { RenderBusyError, RenderTimeoutError, renderPdf } from "@/lib/questionPaper/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 300-question paper with solutions prints in about 5 s on a laptop; this
// leaves room for a cold start and a slower function.
export const maxDuration = 120;

// Within maxDuration: figures get FIGURES_BUDGET_MS (plus one download's own
// 10 s timeout), printing RENDER_TIMEOUT_MS including any wait in line.
const FIGURES_BUDGET_MS = 20000;
const RENDER_TIMEOUT_MS = 80000;
/** A 300-question paper with solutions is well under 2 MB of JSON; Vercel refuses bodies over 4.5 MB. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Different figures in one paper; each is downloaded and embedded. */
const MAX_FIGURES = 600;

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
 *
 * Teachers and tuition accounts only (Chrome is costly to run), checked
 * before the body is read.
 */
export const POST = route(async (req) => {
  await requireUser(req, "teacher", "tuition");

  const raw = await readBody(req, MAX_BODY_BYTES, "This paper is too large to send. Pick fewer questions.");
  let paper: QuestionPaper;
  try {
    paper = parsePaper(JSON.parse(raw.toString("utf8")));
  } catch (error) {
    throw badRequest(error instanceof PaperRequestError ? error.message : "Send the paper as JSON");
  }
  const figureUrls = figureUrlsOf(paper);
  if (figureUrls.length > MAX_FIGURES) {
    throw badRequest(`This paper has ${figureUrls.length} figures; a PDF can have at most ${MAX_FIGURES}. Pick fewer questions.`);
  }

  const started = Date.now();
  let pdf: Uint8Array;
  let pages: number;
  let figureCount: number;
  let figuresDone: number;
  try {
    const figures = await embedFigures(figureUrls, req.headers.get("host") ?? "", FIGURES_BUDGET_MS);
    figureCount = figures.size;
    figuresDone = Date.now();
    pdf = await renderPdf(questionPaperHtml(paper, figures), RENDER_TIMEOUT_MS);
    pages = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  } catch (error) {
    if (error instanceof RenderBusyError) throw new HttpError(503, "The server is busy making other PDFs. Try again in a minute.");
    if (error instanceof RenderTimeoutError) throw new HttpError(504, "Making the PDF took too long. Try again, or pick fewer questions.");
    // The cause stays in the server log; the app gets a plain message.
    console.error("[question-paper-pdf] failed:", error);
    throw new HttpError(500, "Could not make the PDF. Try again.");
  }

  const done = Date.now();
  console.log(
    `[question-paper-pdf] ${paper.questions.length} questions, ${figureCount} figures, ${pages} pages, ` +
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
});
