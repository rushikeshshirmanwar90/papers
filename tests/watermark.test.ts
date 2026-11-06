// Tests for the watermark on exam papers: how the text is cleaned, that a Smart
// PDF never gets one, and (with the local Chrome; skipped without it) that it
// prints on every page without disturbing the paper's text or its layout check.
// No database needed. Run with: npm test
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, describe, test } from "node:test";
import { questionPaperHtml } from "@/lib/questionPaper/html";
import { parsePaper } from "@/lib/questionPaper/parse";
import { renderPaper, setBrowserLauncherForTests } from "@/lib/questionPaper/render";
import { cleanWatermark, MAX_WATERMARK, WATERMARK_COLOR, watermarkFontPt } from "@/lib/questionPaper/watermark";

const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);

after(() => setBrowserLauncherForTests(null));

const question = (n: number) => ({
  questionText: `Question number ${n}: a body of mass ${n} kg moves with uniform velocity. What is its momentum if the speed is 3 m/s?`,
  optionA: "3 kg m/s",
  optionB: "6 kg m/s",
  optionC: "9 kg m/s",
  optionD: "12 kg m/s",
  answerType: "MCQ",
  correctAnswer: "A",
  explanation: "Momentum is mass times velocity.",
  chapter: "Laws of motion",
});

const body = (count: number, over: Record<string, unknown> = {}) => ({
  title: "Watermark",
  standard: "11th",
  subject: "Physics",
  marksPerQuestion: 4,
  questionPaper: true,
  answerKey: true,
  solutions: true,
  questions: Array.from({ length: count }, (_, i) => question(i + 1)),
  ...over,
});

describe("cleanWatermark", () => {
  test("keeps one tidy line", () => {
    assert.equal(cleanWatermark("  Devne   Classes "), "Devne Classes");
    assert.equal(cleanWatermark("Devne\nClasses\t2026"), "Devne Classes 2026");
    assert.equal(cleanWatermark("   "), "");
  });

  test("stops at the longest allowed, without cutting a character in two", () => {
    const long = "ab😀".repeat(30);
    const cleaned = cleanWatermark(long);
    assert.equal(Array.from(cleaned).length, MAX_WATERMARK);
    assert.ok(long.startsWith(cleaned));
  });

  test("a longer name gets a smaller type, within limits", () => {
    assert.ok(watermarkFontPt("DC") > watermarkFontPt("Devne Classes"));
    assert.ok(watermarkFontPt("Devne Classes") > watermarkFontPt("x".repeat(MAX_WATERMARK)));
    assert.equal(watermarkFontPt("D"), 64);
    assert.ok(watermarkFontPt("W".repeat(MAX_WATERMARK)) >= 18);
  });
});

describe("watermark in the request", () => {
  test("an exam paper keeps the cleaned text; none means none", () => {
    assert.equal(parsePaper(body(1, { watermark: " Devne  Classes " })).watermark, "Devne Classes");
    assert.equal(parsePaper(body(1)).watermark, "");
    assert.equal(parsePaper(body(1, { watermark: null })).watermark, "");
  });

  test("a Smart PDF never carries one", () => {
    const smart = parsePaper(body(1, { format: "smart", watermark: "Devne Classes" }));
    assert.equal(smart.format, "smart");
    assert.equal(smart.watermark, "");
  });

  test("text that isn't text is refused", () => {
    assert.throws(() => parsePaper(body(1, { watermark: 5 })), /watermark must be text/);
    assert.throws(() => parsePaper(body(1, { watermark: "x".repeat(501) })), /watermark is too long/);
  });
});

describe("watermark in the page", () => {
  const html = (watermark: string) => questionPaperHtml(parsePaper(body(2, { watermark })), new Map());

  test("sits behind the paper, in light grey, once, and only when asked for", () => {
    const page = html("Devne Classes");
    assert.equal(page.split('class="watermark"').length - 1, 1);
    assert.match(page, /\.watermark \{[^}]*z-index: -1/);
    assert.ok(page.includes(`color: ${WATERMARK_COLOR}`));
    // Before the paper's own parts, so it is painted under them.
    assert.ok(page.indexOf('class="watermark"') < page.indexOf('class="part"'));
    assert.ok(!html("").includes("watermark"));
  });

  test("is escaped, never markup", () => {
    const page = html('<img src=x onerror=alert(1)> & "quote"');
    assert.ok(!page.includes("<img src=x"));
    assert.ok(page.includes("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot;"));
  });
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

describe("watermark in the PDF", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  const make = async (watermark: string, count = 40) => {
    const paper = parsePaper(body(count, { watermark }));
    const { pdf, layout } = await renderPaper(questionPaperHtml(paper, new Map()), count, 100000, paper.watermark);
    return { pdf, layout, texts: await pageTexts(pdf) };
  };

  test("is on every page, questions included, and the layout check stays clean", { timeout: 180000 }, async () => {
    const { layout, texts } = await make("Devne Classes");
    assert.ok(texts.length >= 3, `expected a multi-page paper, got ${texts.length} page(s)`);
    assert.equal(layout.stats.pages, texts.length);
    for (const [i, text] of texts.entries()) {
      assert.ok(text.replace(/\s+/g, "").includes("DevneClasses"), `page ${i + 1} has no watermark`);
    }
    // The paper's own text is all still there, in order.
    const all = texts.join(" ");
    for (const n of [1, 20, 40]) assert.ok(all.includes(`Question number ${n}:`), `question ${n} is missing`);
    assert.deepEqual(layout.issues.filter((issue) => issue.severity === "error"), []);
  });

  test("without one, no page has any, and the check reads the same", { timeout: 180000 }, async () => {
    const { layout, texts } = await make("", 12);
    assert.ok(texts.every((text) => !text.includes("Devne")));
    assert.deepEqual(layout.issues.filter((issue) => issue.severity === "error"), []);
  });

  test("a watermark that looks like a question number can't stand in for one", { timeout: 180000 }, async () => {
    const paper = parsePaper(body(2, { watermark: "(7)" }));
    const { layout } = await renderPaper(questionPaperHtml(paper, new Map()), 7, 100000, paper.watermark);
    // Only two questions were sent, so 3 to 7 must still be reported missing.
    assert.ok(layout.issues.some((issue) => issue.kind === "question-missing" && issue.detail.includes("Question 3")));
  });
});
