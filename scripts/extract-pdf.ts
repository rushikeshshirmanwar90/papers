// Runs the PDF → questions pipeline on a file without uploading it, and
// prints the result as JSON — handy for checking how a new paper comes out.
//
//   npx tsx scripts/extract-pdf.ts path/to/paper.pdf            # questions as JSON
//   npx tsx scripts/extract-pdf.ts path/to/paper.pdf --lines    # raw reading-order lines
//
// Set TEXMATH_DEBUG=1 to trace which glyphs each fraction bar / root claims.
import fs from "fs";
import { extractTexPdf } from "../src/lib/pdfTex";
import { extractStructuredPdf } from "../src/lib/pdfStructured";
import { parseCoachingPaper } from "../src/lib/coachingPaperParser";
import { formatTexExplanation, stripAnswerMarker, tidyProse } from "../src/lib/texExplanation";

(async () => {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error("usage: npx tsx scripts/extract-pdf.ts <paper.pdf> [--lines]");
    process.exit(1);
  }
  const buffer = fs.readFileSync(file);
  const tex = await extractTexPdf(buffer);
  const events = tex.isTex ? tex.events : await extractStructuredPdf(buffer);
  console.error(`${tex.isTex ? "TeX" : "plain"} PDF, ${events.length} events`);

  if (flag === "--lines") {
    for (const e of events) if (e.kind === "text") console.log(e.value);
    return;
  }

  const { questions } = parseCoachingPaper(events);
  const out = questions.map((q) => {
    const { answer, text } = stripAnswerMarker(q.explanation);
    return {
      questionNumber: q.questionNumber,
      subject: q.subject,
      section: q.section,
      questionText: tidyProse(q.questionText),
      optionA: tidyProse(q.optionA),
      optionB: tidyProse(q.optionB),
      optionC: tidyProse(q.optionC),
      optionD: tidyProse(q.optionD),
      correctAnswer: q.correctAnswer || answer || "",
      answerType: q.answerType,
      explanation: tex.isTex ? formatTexExplanation(text) : q.explanation,
      diagrams: q.diagrams.length,
    };
  });
  console.log(JSON.stringify(out, null, 2));
})();
