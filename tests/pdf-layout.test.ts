// Tests for the question paper's overflow-safe layout: where long formulas may
// break, and that Chrome's measuring pass and the check on the finished PDF
// keep everything inside its column and report what can't be fixed. Real PDFs
// are printed with the local Chrome (skipped without it). No database needed.
// Run with: npm test
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, describe, test } from "node:test";
import { checkPdf } from "@/lib/questionPaper/layoutFit";
import { questionPaperHtml, type PaperQuestion, type QuestionPaper } from "@/lib/questionPaper/html";
import { breakPoints, splitMath } from "@/lib/questionPaper/mathBreak";
import { renderPaper, renderPdf, setBrowserLauncherForTests } from "@/lib/questionPaper/render";

const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);

after(() => setBrowserLauncherForTests(null));

// ─── Where a formula may break ─────────────────────────────────────────────

describe("splitMath", () => {
  const rejoined = (pieces: string[]) => pieces.join(" ").replace(/\s+/g, "");
  const squash = (tex: string) => tex.replace(/\s+/g, "");

  test("short formulas are left whole", () => {
    assert.deepEqual(splitMath("x = 1"), ["x = 1"]);
    assert.deepEqual(splitMath("\\frac{a}{b}"), ["\\frac{a}{b}"]);
  });

  test("breaks after relations and binary operators at the top level", () => {
    const tex = "F = qE = q\\frac{V}{d} = \\frac{q\\sigma}{\\epsilon_0} + \\frac{qQ}{\\epsilon_0 A} - \\frac{1}{2}";
    const pieces = splitMath(tex);
    assert.ok(pieces.length >= 5, `got ${pieces.length}`);
    assert.equal(rejoined(pieces), squash(tex), "the pieces give back the formula");
    for (const piece of pieces.slice(0, -1)) assert.match(piece, /(=|\+|-)$/, "each line but the last ends with its operator");
  });

  test("never breaks inside a fraction, root, sub/superscript or text", () => {
    const tex = "\\frac{a + b + c}{d - e - f} = \\sqrt{x + y + z + w} + e^{-i\\omega t + \\phi} + \\text{some words = here} + k_{n+1}";
    const pieces = splitMath(tex);
    for (const piece of pieces) {
      const open = (piece.match(/{/g) ?? []).length;
      const close = (piece.match(/}/g) ?? []).length;
      assert.equal(open, close, `unbalanced piece: ${piece}`);
    }
    assert.equal(rejoined(pieces), squash(tex));
    // The only top-level operators are the three "+" and the "=": four breaks, five pieces.
    assert.equal(pieces.length, 5);
  });

  test("never breaks inside \\left…\\right, brackets or a matrix", () => {
    const tex = "\\left(a + b + c + d + e + f + g + h\\right) = \\begin{pmatrix} a + b & c = d \\\\ e - f & g \\end{pmatrix} + (p + q + r + s + t) + [u - v]";
    const pieces = splitMath(tex);
    assert.equal(rejoined(pieces), squash(tex));
    for (const piece of pieces) {
      assert.equal((piece.match(/\\left/g) ?? []).length, (piece.match(/\\right/g) ?? []).length, `split a \\left…\\right: ${piece}`);
      assert.equal((piece.match(/\\begin/g) ?? []).length, (piece.match(/\\end/g) ?? []).length, `split an environment: ${piece}`);
      assert.equal((piece.match(/\(/g) ?? []).length, (piece.match(/\)/g) ?? []).length, `split a bracket: ${piece}`);
    }
    assert.equal(pieces.length, 4, "after the first =, after each of the two +");
  });

  test("a sign is not a binary operator", () => {
    const tex = "x = -y + z \\times -w \\cdot e^{-1} + t^-1 + \\alpha";
    const cuts = breakPoints(tex).map((i) => tex.slice(0, i).trimEnd().slice(-1));
    // After "=", "-y" is a sign: the first cut is after "=", the next after "+".
    assert.deepEqual(cuts.slice(0, 2), ["=", "+"]);
  });

  test("a formula with nowhere valid to break stays in one piece", () => {
    const tex = "\\left(\\frac{a_1 + a_2 + a_3 + a_4 + a_5 + a_6}{b_1 + b_2 + b_3 + b_4 + b_5 + b_6}\\right)^{n}";
    assert.deepEqual(splitMath(tex), [tex]);
  });
});

// ─── Real layout, printed with Chrome ──────────────────────────────────────

const TOKEN = "Supercalifragilisticexpialidocious_unbroken_token_that_is_far_too_wide_for_a_column";
const terms = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_{${i + 1}}`).join(" + ");
const group = (n: number) => `\\(\\left(\\frac{${terms("a", n)}}{${terms("b", n)}}\\right)^2\\)`;

/** A small PNG, as wide as asked: the figures in the question bank are raster images or SVG. */
async function figure(width: number, height: number): Promise<string> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  g.strokeStyle = "#000";
  g.lineWidth = 6;
  g.strokeRect(3, 3, width - 6, height - 6);
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}
const WIDE_SVG = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect x="2" y="2" width="396" height="196" fill="none" stroke="#000" stroke-width="4"/></svg>'
).toString("base64")}`;

const question = (over: Partial<PaperQuestion>): PaperQuestion => ({
  questionText: "",
  optionA: "a",
  optionB: "b",
  optionC: "c",
  optionD: "d",
  answerType: "MCQ",
  correctAnswer: "A",
  explanation: "",
  chapter: "EMI",
  source: "",
  diagramUrls: [],
  optionDiagramUrls: { A: [], B: [], C: [], D: [] },
  explanationDiagramUrls: [],
  ...over,
});

const paperOf = (questions: PaperQuestion[], over: Partial<QuestionPaper> = {}): QuestionPaper => ({
  title: "Layout",
  institute: "Test institute",
  standard: "12th",
  subject: "Physics",
  marksPerQuestion: 4,
  paperSet: "1",
  date: "2026-08-30",
  durationMinutes: 90,
  questionPaper: true,
  answerKey: true,
  solutions: true,
  strictLayout: false,
  questions,
  ...over,
});

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const { loadPdfjs } = await import("@/lib/pdfjsNode");
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return texts;
}

describe("overflow-safe layout", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  test("every regression case fits: long formulas, tokens, options, diagrams", { timeout: 120000 }, async () => {
    const wide = await figure(1800, 220);
    const big = await figure(2400, 1600);
    const embedded = new Map<string, string | null>([
      ["wide", wide],
      ["big", big],
      ["svg", WIDE_SVG],
      ["missing", null],
    ]);
    const inline =
      "\\(\\frac{\\mu_0 N_1 N_2 \\pi r_1^2 r_2^2}{2 (r_1^2 + x^2)^{3/2}} + \\sqrt{\\frac{a^2 + b^2 + c^2}{d^2 + e^2}} = \\frac{\\sqrt{3}\\,\\mu_0 I}{4\\pi R} \\left(\\sin\\theta_1 + \\sin\\theta_2\\right) + \\frac{\\epsilon_0 E^2 A d}{2} - \\frac{B^2 V}{2\\mu_0}\\)";
    const chain =
      "\\[ F = qE = q\\frac{V}{d} = \\frac{q\\sigma}{\\epsilon_0} = \\frac{qQ}{\\epsilon_0 A} = \\frac{1}{4\\pi\\epsilon_0}\\frac{qQ}{r^2} = 9\\times10^{9}\\times\\frac{1.6\\times10^{-19}\\times 3.2\\times10^{-19}}{(10^{-10})^2} = 4.608\\times10^{-8}\\ N \\]";
    const integral =
      "\\(\\int_0^{\\infty}\\int_0^{\\pi}\\int_0^{2\\pi} r^2\\sin\\theta\\, e^{-r^2/2\\sigma^2}\\,d\\phi\\, d\\theta\\, dr = \\left(2\\pi\\sigma^2\\right)^{3/2} \\Rightarrow \\oint_C \\vec{B}\\cdot d\\vec{l} = \\mu_0 I_{enc} + \\mu_0\\epsilon_0\\frac{d\\Phi_E}{dt}\\)";
    const questions = [
      question({ questionText: `Long inline: ${inline} Which?` }),
      question({ questionText: `Chained: ${chain} Find F.` }),
      question({ questionText: `Integral: ${integral}` }),
      question({ questionText: `Token: ${TOKEN} end.`, optionA: TOKEN, optionB: "short" }),
      question({ questionText: "Wide diagrams.", diagramUrls: ["wide", "big", "svg", "missing"] }),
      question({ questionText: "Short options that crowd when two to a row.", optionA: "electromagnetic_field", optionB: "\\(\\frac{\\mu_0 N^2 A l^2}{4\\pi^2 L R S}\\)", optionC: "plain", optionD: "short" }),
      question({
        questionText: "Long options.",
        optionA: "The magnetic flux through the surface is zero because the field lines form closed loops and no monopole exists",
        optionB: `\\(\\frac{\\mu_0 N^2 A}{l} + \\frac{\\mu_0 N^2 A}{2l} + \\frac{\\mu_0 N^2 A}{3l} + \\frac{\\mu_0 N^2 A}{4l}\\)`,
        optionC: "electromagnetic_field",
        optionD: "\\(\\frac{\\mu_0 N^2 A l^2}{4\\pi^2 L R S}\\)",
      }),
      question({
        questionText: `LaTeX and images: ${inline}`,
        diagramUrls: ["svg"],
        optionDiagramUrls: { A: [], B: ["wide"], C: [], D: [] },
        explanation: `Because ${chain} and ${integral}`,
        explanationDiagramUrls: ["wide"],
      }),
      question({ questionText: `Needs scaling: ${group(24)} Which?` }),
    ];
    const html = questionPaperHtml(paperOf(questions), embedded);
    const { pdf, layout } = await renderPaper(html, questions.length, 100000);

    assert.deepEqual(
      layout.issues.filter((issue) => issue.severity === "error"),
      [],
      `layout errors: ${JSON.stringify(layout.issues.filter((i) => i.severity === "error"))}`
    );
    assert.ok(layout.stats.optionsStacked >= 1, "crowded two-up options were stacked");
    assert.ok(layout.stats.equationsScaled >= 1, "an equation with no valid break was scaled");
    assert.equal(layout.stats.rasterFigures > 0, true);
    // The checker found every question and figure, and nothing outside the frame.
    const texts = await pageTexts(pdf);
    assert.ok(texts.every((t) => t.trim().length > 0), "no blank page");
    assert.match(texts.join(" "), /Supercalifragilisticexpialidocious/);
  });

  test("an equation too wide to read is an error, not a clipped PDF", { timeout: 120000 }, async () => {
    const html = questionPaperHtml(paperOf([question({ questionText: `Too wide: ${group(70)}` })], { answerKey: false, solutions: false }), new Map());
    const { layout } = await renderPaper(html, 1, 100000);
    const unreadable = layout.issues.filter((issue) => issue.kind === "equation-unreadable");
    assert.equal(unreadable.length, 1);
    assert.equal(unreadable[0].severity, "error");
    assert.equal(unreadable[0].where, "Question 1");
    assert.equal(layout.issues.some((issue) => issue.kind === "text-outside-page"), false, "even so, nothing is printed outside the frame");
  });

  test("an answer wider than its box widens the box", { timeout: 120000 }, async () => {
    const answer = "\\(4.608\\times10^{-8} + 1.2\\times10^{-9} - 3.3\\times10^{-10} + 7.7\\times10^{-11}\\)";
    const html = questionPaperHtml(
      paperOf([question({ answerType: "Numerical", correctAnswer: answer })], { questionPaper: false, solutions: false }),
      new Map()
    );
    const { layout } = await renderPaper(html, 0, 100000);
    assert.equal(layout.issues.filter((issue) => issue.severity === "error").length, 0);
  });

  test("the check on the finished PDF finds text outside the frame, a missing question and an empty page", { timeout: 120000 }, async () => {
    // Text printed below the frame (here in the page margin) that isn't a page number.
    const html = `<!DOCTYPE html><html><head><style>
      @page { size: A4; margin: 6mm 6mm 12mm; @bottom-left { content: "stray words"; font: 10pt sans-serif; } }
      body { margin: 0; font: 12pt sans-serif; }
      .page { break-after: page; height: 100mm; }
    </style></head><body><div class="page"><span>(1)</span> a question</div><div class="page"></div></body></html>`;
    const pdf = await renderPdf(html, 60000);
    const { issues } = await checkPdf(pdf, { questions: 2, figures: 0 });
    const kinds = issues.map((issue) => issue.kind);
    assert.ok(kinds.includes("text-outside-page"), kinds.join(", "));
    assert.ok(kinds.includes("question-missing"), kinds.join(", "));
    assert.ok(kinds.includes("blank-page"), kinds.join(", "));
  });

  test("a figure missing from the pages is found", { timeout: 120000 }, async () => {
    const pdf = await renderPdf("<!DOCTYPE html><html><body>(1) no pictures here</body></html>", 60000);
    const { issues } = await checkPdf(pdf, { questions: 1, figures: 2 });
    assert.ok(issues.some((issue) => issue.kind === "figure-missing"));
  });
});
