// Multi-subject Exam PDF: questions grouped by subject under compact headings,
// continuous numbering, single-subject papers unchanged, headings never left
// alone at the bottom of a column. Real PDFs are printed with the local Chrome
// (skipped without it). No database needed.
// Run with: npx tsx --test tests/multi-subject-paper.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { arrangeQuestions, questionPaperHtml, type PaperQuestion, type QuestionPaper } from "@/lib/questionPaper/html";
import { renderPaper, setBrowserLauncherForTests } from "@/lib/questionPaper/render";

const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);
/** Set to a folder to keep the printed sample PDFs there. */
const SAMPLES = process.env.PAPER_SAMPLES_DIR;

after(() => setBrowserLauncherForTests(null));

const question = (subject: string | undefined, n: number, over: Partial<PaperQuestion> = {}): PaperQuestion => ({
  subject,
  questionText: `${subject || "Unlabelled"} question ${n}: a body of text long enough to wrap onto a second line in a narrow column of the paper.`,
  optionA: "first",
  optionB: "second",
  optionC: "third",
  optionD: "fourth",
  answerType: "MCQ",
  correctAnswer: "A",
  explanation: "",
  chapter: "Mixed",
  source: "",
  diagramUrls: [],
  optionDiagramUrls: { A: [], B: [], C: [], D: [] },
  explanationDiagramUrls: [],
  ...over,
});

const many = (subject: string, count: number) => Array.from({ length: count }, (_, i) => question(subject, i + 1));

const paperOf = (questions: PaperQuestion[], over: Partial<QuestionPaper> = {}): QuestionPaper => ({
  title: "JEE MAIN MOCK TEST",
  institute: "DEVNE CLASSES",
  standard: "12th",
  // As the app writes it: the subjects in question order.
  subject: [...new Set(questions.map((q) => q.subject).filter(Boolean))].join(", "),
  marksPerQuestion: 4,
  paperSet: "1",
  date: "2026-08-30",
  durationMinutes: 180,
  questionPaper: true,
  answerKey: false,
  solutions: false,
  strictLayout: false,
  questions,
  ...over,
});

const headings = (html: string) =>
  [...html.matchAll(/<span class="subject-name">([^<]*)<\/span><span class="subject-count">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
const numbers = (html: string) => [...html.matchAll(/<span class="number">\((\d+)\)<\/span>/g)].map((m) => Number(m[1]));
const bodyOrder = (html: string) => [...html.matchAll(/(\w+) question (\d+):/g)].map((m) => `${m[1]}${m[2]}`);

describe("subject grouping", () => {
  test("three subjects: a heading each with its count, continuous numbering, no section letters", () => {
    const html = questionPaperHtml(paperOf([...many("Physics", 3), ...many("Chemistry", 2), ...many("Mathematics", 4)]), new Map());
    assert.deepEqual(headings(html), [["PHYSICS", "3 Questions"], ["CHEMISTRY", "2 Questions"], ["MATHEMATICS", "4 Questions"]]);
    assert.deepEqual(numbers(html), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.doesNotMatch(html, /class="section-title"><span>SECTION/i);
  });

  test("two subjects, unequal; a single question reads '1 Question'", () => {
    const html = questionPaperHtml(paperOf([...many("Biology", 1), ...many("Physics", 5)]), new Map());
    assert.deepEqual(headings(html), [["BIOLOGY", "1 Question"], ["PHYSICS", "5 Questions"]]);
  });

  test("subject order is first appearance; interleaved questions keep their order within a subject; none are lost", () => {
    const input = [question("Chemistry", 1), question("Physics", 1), question("Chemistry", 2), question("Physics", 2), question("Mathematics", 1)];
    const arranged = arrangeQuestions(paperOf(input));
    assert.equal(arranged.questions.length, input.length);
    assert.deepEqual(
      arranged.questions.map((q) => `${q.subject}${q.questionText.match(/question (\d+)/)![1]}`),
      ["Chemistry1", "Chemistry2", "Physics1", "Physics2", "Mathematics1"]
    );
    const html = questionPaperHtml(paperOf(input), new Map());
    assert.deepEqual(headings(html).map((h) => h[0]), ["CHEMISTRY", "PHYSICS", "MATHEMATICS"]);
    assert.deepEqual(bodyOrder(html), ["Chemistry1", "Chemistry2", "Physics1", "Physics2", "Mathematics1"]);
  });

  test("a reordered selection keeps the teacher's order inside each subject", () => {
    const physics = many("Physics", 3).reverse();
    const html = questionPaperHtml(paperOf([...physics, ...many("Chemistry", 2)]), new Map());
    assert.deepEqual(bodyOrder(html), ["Physics3", "Physics2", "Physics1", "Chemistry1", "Chemistry2"]);
  });

  test("automatic order is first appearance; a manual list in the request sets the order, never dropping or duplicating", () => {
    const questions = [...many("Physics", 2), ...many("Chemistry", 2), ...many("Mathematics", 1)];
    const auto = questionPaperHtml(paperOf(questions, { subject: "Physics, Chemistry, Mathematics" }), new Map());
    assert.deepEqual(headings(auto).map((h) => h[0]), ["PHYSICS", "CHEMISTRY", "MATHEMATICS"]);
    const manual = questionPaperHtml(paperOf(questions, { subject: "Mathematics, Chemistry" }), new Map());
    // Named subjects first in the listed order; Physics, not named, follows.
    assert.deepEqual(headings(manual).map((h) => h[0]), ["MATHEMATICS", "CHEMISTRY", "PHYSICS"]);
    assert.deepEqual(bodyOrder(manual), ["Mathematics1", "Chemistry1", "Chemistry2", "Physics1", "Physics2"]);
    assert.equal(numbers(manual).length, questions.length);
    const none = questionPaperHtml(paperOf(questions, { subject: "" }), new Map());
    assert.deepEqual(headings(none).map((h) => h[0]), ["PHYSICS", "CHEMISTRY", "MATHEMATICS"]);
  });

  test("questions without a subject are kept, under 'Other', never an empty subject section", () => {
    const html = questionPaperHtml(paperOf([...many("Physics", 2), question(undefined, 1), question("", 2)]), new Map());
    assert.deepEqual(headings(html), [["PHYSICS", "2 Questions"], ["OTHER", "2 Questions"]]);
    assert.equal(numbers(html).length, 4);
  });

  test("Botany and Zoology print as Biology", () => {
    const html = questionPaperHtml(paperOf([...many("Botany", 1), ...many("Zoology", 1), ...many("Physics", 1)]), new Map());
    assert.deepEqual(headings(html), [["BIOLOGY", "2 Questions"], ["PHYSICS", "1 Question"]]);
  });
});

describe("single-subject compatibility", () => {
  test("one subject adds no subject heading and keeps the existing section layout", () => {
    const html = questionPaperHtml(paperOf(many("Physics", 3), { subject: "Physics" }), new Map());
    assert.deepEqual(headings(html), []);
    assert.match(html, /class="section-title"><span>SECTION A - PHYSICS/);
    assert.match(html, /<div class="field"><b>Subject<\/b><span>: Physics<\/span>/);
  });

  test("questions with no subject at all are unchanged", () => {
    const html = questionPaperHtml(paperOf(many("x", 2).map((q) => ({ ...q, subject: undefined })), { subject: "Physics" }), new Map());
    assert.deepEqual(headings(html), []);
    assert.match(html, /Physics - Section A/);
  });

  test("header totals come from the actual questions and the marking rule", () => {
    const html = questionPaperHtml(paperOf([...many("Physics", 3), ...many("Chemistry", 2)], { marksPerQuestion: 4 }), new Map());
    assert.match(html, /<b>Total Mark<\/b><span>: 20<\/span>/);
    assert.match(html, /<b>Paper Set<\/b><span>: 1<\/span>/);
    assert.match(html, /DEVNE CLASSES/);
  });

  test("answer key and solutions share the same numbering as the questions", () => {
    const html = questionPaperHtml(
      paperOf([question("Chemistry", 1), question("Physics", 1), question("Chemistry", 2)], { answerKey: true, solutions: true }),
      new Map()
    );
    assert.deepEqual(numbers(html), [1, 2, 3, 1, 2, 3]);
    assert.deepEqual(bodyOrder(html).slice(0, 3), ["Chemistry1", "Chemistry2", "Physics1"]);
    assert.deepEqual(bodyOrder(html).slice(3), ["Chemistry1", "Chemistry2", "Physics1"]);
  });
});

// ─── Answer key and solutions ──────────────────────────────────────────────

const withAnswer = (subject: string, n: number, correctAnswer: string, over: Partial<PaperQuestion> = {}) => question(subject, n, { correctAnswer, ...over });

/** The answer key's tables: [title, cells]. */
const keyTables = (html: string) => {
  const key = html.split('data-part="key"')[1]?.split("</section>")[0] ?? "";
  return [...key.matchAll(/<div class="key-block"><div class="section-title"><span>(.*?)<\/span><\/div><div class="key[^"]*"[^>]*>(.*?<\/div>)<\/div><\/div>/g)].map(
    (m) => [m[1], [...m[2].matchAll(/<div>(.*?)<\/div>/g)].map((c) => c[1])] as [string, string[]]
  );
};
const solutionsPart = (html: string) => html.split('data-part="solutions"')[1] ?? "";

describe("subject-wise answer key", () => {
  const input = [
    withAnswer("Chemistry", 1, "D"),
    withAnswer("Physics", 1, "B"),
    withAnswer("Chemistry", 2, "C"),
    withAnswer("Physics", 2, "A, C"),
    withAnswer("Mathematics", 1, "42", { answerType: "Numerical" }),
    withAnswer("Mathematics", 2, "0.5", { answerType: "Numerical" }),
    withAnswer("Mathematics", 3, "B"),
    withAnswer("Mathematics", 4, ""),
  ];

  test("one table per subject in question-paper order, continuous numbers, each answer with its own question, no Section A/B", () => {
    const html = questionPaperHtml(paperOf(input, { answerKey: true }), new Map());
    assert.deepEqual(keyTables(html), [
      ["CHEMISTRY", ["1 - D", "2 - C"]],
      ["PHYSICS", ["3 - B", "4 - A, C"]],
      ["MATHEMATICS", ["5 - 42", "6 - 0.5", "7 - B", "8 - –"]],
    ]);
    assert.doesNotMatch(html.split('data-part="key"')[1].split("</section>")[0], /SECTION [A-Z]/i);
  });

  test("two subjects and unequal counts", () => {
    const html = questionPaperHtml(paperOf([...many("Biology", 1), ...many("Physics", 3)], { answerKey: true }), new Map());
    assert.deepEqual(keyTables(html).map(([title, cells]) => [title, cells.length]), [["BIOLOGY", 1], ["PHYSICS", 3]]);
  });

  test("the key follows a manual subject order too", () => {
    const html = questionPaperHtml(paperOf(input, { answerKey: true, subject: "Mathematics, Physics, Chemistry" }), new Map());
    assert.deepEqual(keyTables(html).map(([title]) => title), ["MATHEMATICS", "PHYSICS", "CHEMISTRY"]);
    assert.deepEqual(keyTables(html)[0][1], ["1 - 42", "2 - 0.5", "3 - B", "4 - –"]);
    assert.deepEqual(keyTables(html)[2][1], ["7 - D", "8 - C"]);
  });

  test("single-subject keys keep their section tables", () => {
    const html = questionPaperHtml(
      paperOf([withAnswer("Physics", 1, "B"), withAnswer("Physics", 2, "7", { answerType: "Numerical" })], { subject: "Physics", answerKey: true }),
      new Map()
    );
    assert.deepEqual(keyTables(html).map(([title]) => title), ["SECTION A - PHYSICS <small>(MCQ)</small>", "SECTION B - PHYSICS <small>(Numerical)</small>"]);
    assert.deepEqual(keyTables(html)[1][1], ["2 - 7"]);
  });

  test("a separate answer-key export has the key and no question pages", () => {
    const html = questionPaperHtml(paperOf(input, { questionPaper: false, answerKey: true }), new Map());
    assert.doesNotMatch(html, /<div class="question">/);
    assert.doesNotMatch(html, /data-part="questions"/);
    assert.equal(keyTables(html).length, 3);
    assert.match(html, /Answer Key/);
  });

  test("a questions-only paper has no key", () => {
    const html = questionPaperHtml(paperOf(input), new Map());
    assert.equal(keyTables(html).length, 0);
    assert.doesNotMatch(html, /data-part="key"/);
  });
});

describe("subject-wise solutions", () => {
  const input = [
    withAnswer("Chemistry", 1, "D", { explanation: "Because \\(x^2 = 4\\)." }),
    withAnswer("Physics", 1, "B", { explanation: "" }),
    withAnswer("Chemistry", 2, "C", { explanation: "Second chemistry solution." }),
    withAnswer("Mathematics", 1, "42", { answerType: "Numerical", explanation: "Numerical working." }),
  ];

  test("subject headings, matching numbers and answers, missing explanations handled", () => {
    const html = questionPaperHtml(paperOf(input, { solutions: true, questionPaper: false }), new Map());
    const part = solutionsPart(html);
    assert.deepEqual(headings(part).map((h) => h[0]), ["CHEMISTRY", "PHYSICS", "MATHEMATICS"]);
    const blocks = [...part.matchAll(/<span class="number">\((\d+)\)<\/span><div class="stem">(\w+) question \d+:.*?Correct Answer:(.*?)\)<\/div><div class="solution-body">(.*?)<\/div>/g)];
    assert.deepEqual(blocks.map((m) => [m[1], m[2], m[3]]), [["1", "Chemistry", "D"], ["2", "Chemistry", "C"], ["3", "Physics", "B"], ["4", "Mathematics", "42"]]);
    assert.match(blocks[0][4], /<math/, "maths still renders");
    assert.match(blocks[2][4], /worked solution isn't in the question bank/);
  });

  test("the key, the solutions and the questions number the same questions the same way", () => {
    const html = questionPaperHtml(paperOf(input, { answerKey: true, solutions: true }), new Map());
    assert.deepEqual(numbers(html), [1, 2, 3, 4, 1, 2, 3, 4]);
    assert.deepEqual(bodyOrder(html).slice(0, 4), bodyOrder(html).slice(4));
    assert.deepEqual(keyTables(html).map(([title]) => title), ["CHEMISTRY", "PHYSICS", "MATHEMATICS"]);
  });

  test("single-subject solutions are unchanged", () => {
    const html = questionPaperHtml(paperOf([withAnswer("Physics", 1, "B", { explanation: "x" })], { subject: "Physics", solutions: true }), new Map());
    assert.deepEqual(headings(html), []);
    assert.match(solutionsPart(html), /SECTION A - PHYSICS/);
  });
});

async function layoutOf(pdf: Uint8Array) {
  const { loadPdfjs } = await import("@/lib/pdfjsNode");
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const pages: { text: string; items: { str: string; x: number; y: number }[]; width: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => "str" in i && i.str.trim())
      .map((i) => ({ str: (i as { str: string }).str, x: (i as { transform: number[] }).transform[4], y: (i as { transform: number[] }).transform[5] }));
    pages.push({ text: items.map((i) => i.str).join(" "), items, width: page.view[2] });
  }
  return pages;
}

describe("printed paper", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  const save = (name: string, pdf: Uint8Array) => {
    if (!SAMPLES) return;
    mkdirSync(SAMPLES, { recursive: true });
    writeFileSync(path.join(SAMPLES, name), pdf);
  };
  const errors = (layout: { issues: { severity: string }[] }) => layout.issues.filter((i) => i.severity === "error");

  test("a three-subject paper prints every question once, numbered 1..N, subjects in order", { timeout: 120000 }, async () => {
    const questions = [...many("Physics", 12), ...many("Chemistry", 12), ...many("Mathematics", 11)];
    const { pdf, layout } = await renderPaper(questionPaperHtml(paperOf(questions), new Map()), questions.length, 100000);
    save("three-subjects.pdf", pdf);
    assert.deepEqual(errors(layout), []);
    const pages = await layoutOf(pdf);
    const text = pages.map((p) => p.text).join(" ");
    for (let n = 1; n <= 35; n++) assert.match(text, new RegExp(`\\(${n}\\)`), `question ${n} is printed`);
    const order = ["PHYSICS", "CHEMISTRY", "MATHEMATICS"].map((s) => text.indexOf(s));
    assert.ok(order[0] > -1 && order[0] < order[1] && order[1] < order[2], "subjects print in order");
    assert.match(text, /12 Questions/);
    assert.match(text, /11 Questions/);
    assert.ok(pages.length > 1, "spans several pages without forcing a page per subject");
    assert.doesNotMatch(text, /Section A/i);
  });

  test("a heading is never the last thing in a column, wherever it lands", { timeout: 300000 }, async () => {
    for (let before = 3; before <= 13; before++) {
      const questions = [...many("Physics", before), ...many("Chemistry", 6), ...many("Mathematics", 4)];
      const { pdf, layout } = await renderPaper(questionPaperHtml(paperOf(questions), new Map()), questions.length, 100000);
      if (before === 7) save("heading-near-boundary.pdf", pdf);
      assert.deepEqual(errors(layout), [], `layout errors with ${before} before`);
      for (const page of await layoutOf(pdf)) {
        const half = page.width / 2;
        for (const head of page.items.filter((i) => /^(CHEMISTRY|MATHEMATICS)$/.test(i.str))) {
          const below = page.items.filter(
            (i) => i.y < head.y - 8 && i.y > head.y - 60 && i.x < half === head.x < half && !/Questions?$/.test(i.str)
          );
          assert.ok(below.length > 0, `${head.str} is alone at the bottom of a column (${before} questions before it)`);
        }
      }
    }
  });

  test("long math inside a multi-subject paper, with answer key and solutions, still fits", { timeout: 120000 }, async () => {
    const chain =
      "\\[ F = qE = q\\frac{V}{d} = \\frac{q\\sigma}{\\epsilon_0} = \\frac{qQ}{\\epsilon_0 A} = \\frac{1}{4\\pi\\epsilon_0}\\frac{qQ}{r^2} = 9\\times10^{9}\\times\\frac{1.6\\times10^{-19}\\times 3.2\\times10^{-19}}{(10^{-10})^2} \\]";
    const questions = [
      question("Physics", 1, { questionText: `Chained: ${chain} Find F.` }),
      question("Physics", 2, { optionA: "\\(\\frac{\\mu_0 N^2 A}{l} + \\frac{\\mu_0 N^2 A}{2l} + \\frac{\\mu_0 N^2 A}{3l}\\)" }),
      question("Chemistry", 1, { questionText: `Equation ${chain}` }),
      question("Chemistry", 2),
      question("Mathematics", 1, { answerType: "Numerical", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "42" }),
    ];
    const html = questionPaperHtml(paperOf(questions, { answerKey: true, solutions: true }), new Map());
    const { pdf, layout } = await renderPaper(html, questions.length, 100000);
    save("long-math.pdf", pdf);
    assert.deepEqual(errors(layout), []);
  });

  test("answer key and solutions pages print subject by subject", { timeout: 120000 }, async () => {
    const questions = [
      ...Array.from({ length: 14 }, (_, i) => withAnswer("Physics", i + 1, "ABCD"[i % 4], { explanation: `Physics working ${i + 1}.` })),
      ...Array.from({ length: 12 }, (_, i) => withAnswer("Chemistry", i + 1, i % 5 === 0 ? "A, C" : "ABCD"[(i + 1) % 4], { explanation: i === 3 ? "" : `Chemistry working ${i + 1}.` })),
      ...Array.from({ length: 9 }, (_, i) => withAnswer("Mathematics", i + 1, String(10 + i), { answerType: "Numerical", explanation: `Maths working ${i + 1}.` })),
    ];
    const { pdf, layout } = await renderPaper(questionPaperHtml(paperOf(questions, { answerKey: true, solutions: true }), new Map()), questions.length, 100000);
    save("answer-key-and-solutions.pdf", pdf);
    assert.deepEqual(errors(layout), []);
    const pages = await layoutOf(pdf);
    const keyPage = pages.find((p) => /Answer Key/.test(p.text))!;
    assert.ok(keyPage, "there is an answer key page");
    for (const name of ["PHYSICS", "CHEMISTRY", "MATHEMATICS"]) assert.match(keyPage.text, new RegExp(name));
    assert.match(keyPage.text, /35 - 18/);
    assert.doesNotMatch(keyPage.text, /SECTION/i);
    const separate = await renderPaper(questionPaperHtml(paperOf(questions, { questionPaper: false, answerKey: true }), new Map()), 0, 100000);
    save("answer-key-only.pdf", separate.pdf);
    assert.deepEqual(errors(separate.layout), []);
  });

  test("single-subject keeps its layout; a two-subject sample prints", { timeout: 120000 }, async () => {
    const one = many("Physics", 14);
    const r1 = await renderPaper(questionPaperHtml(paperOf(one, { subject: "Physics" }), new Map()), one.length, 100000);
    save("single-subject.pdf", r1.pdf);
    assert.deepEqual(errors(r1.layout), []);
    assert.doesNotMatch((await layoutOf(r1.pdf)).map((p) => p.text).join(" "), /\d+ Questions/);
    const two = [...many("Physics", 9), ...many("Biology", 4)];
    const r2 = await renderPaper(questionPaperHtml(paperOf(two, { subject: "Physics, Biology" }), new Map()), two.length, 100000);
    save("two-subjects.pdf", r2.pdf);
    assert.deepEqual(errors(r2.layout), []);
  });
});
