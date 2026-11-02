// Smart PDF tests: settings and request parsing, then the slide layout as
// Chrome measures it (no PDF printed for those), then one mixed PDF printed
// and read back to check its pages. Chrome tests are skipped without a local
// Chrome. Run with: npx tsx --test tests/smart-pdf.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, describe, test } from "node:test";
import { loadPdfjs } from "@/lib/pdfjsNode";
import { richText, richTokens, type PaperQuestion, type QuestionPaper } from "@/lib/questionPaper/html";
import { parsePaper } from "@/lib/questionPaper/parse";
import { renderSlides, setBrowserLauncherForTests } from "@/lib/questionPaper/render";
import { FIGURE_PX, MEDIUM_MAX_SHARE, minFontPx, smartSlidesHtml, type SlideFitResult } from "@/lib/smartSlides/html";
import {
  DEFAULT_SMART_SLIDE_SETTINGS,
  FONT_PX,
  MIN_FONT_PX,
  normalizeSlideSettings,
  SLIDE,
  slideGeometry,
  slidePrefsKey,
  type SmartSlideSettings,
} from "@/lib/smartSlides/layout";

const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);

after(() => setBrowserLauncherForTests(null));

const noFigures = { A: [], B: [], C: [], D: [] };
const q = (over: Partial<PaperQuestion>): PaperQuestion => ({
  questionText: "",
  optionA: "",
  optionB: "",
  optionC: "",
  optionD: "",
  answerType: "MCQ",
  correctAnswer: "B",
  explanation: "Because the worked solution says so.",
  chapter: "Kinematics",
  source: "JEE MAIN 2020",
  diagramUrls: [],
  optionDiagramUrls: noFigures,
  explanationDiagramUrls: [],
  ...over,
});

/** A line drawing w × h px, as figures come from the question bank. */
const svg = (w: number, h: number) =>
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#000" stroke-width="3"/><line x1="0" y1="0" x2="${w}" y2="${h}" stroke="#000" stroke-width="3"/></svg>`
  ).toString("base64");
const FIGURES = new Map([
  ["https://example.invalid/circuit.svg", svg(400, 300)],
  ["https://example.invalid/opt-a.svg", svg(120, 90)],
  ["https://example.invalid/opt-b.svg", svg(120, 90)],
  ["https://example.invalid/opt-c.svg", svg(120, 90)],
  ["https://example.invalid/opt-d.svg", svg(120, 90)],
]);

const statements = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Statement ${i + 1}: a block of mass \\(m\\) slides down a rough incline of angle \\(\\theta\\) with coefficient of friction \\(\\mu\\), starting from rest.`
  ).join(" ");

const S = {
  short: q({ questionText: "The SI unit of force is", optionA: "Newton", optionB: "Joule", optionC: "Watt", optionD: "Pascal" }),
  medium: q({
    questionText:
      "A uniform rod of mass \\(M\\) and length \\(L\\) is pivoted at one end and released from rest in the horizontal position. " +
      "Neglect friction at the pivot and air resistance. When the rod passes through the vertical position, its angular speed \\(\\omega\\) is " +
      "related to \\(g\\) and \\(L\\). The moment of inertia of the rod about the pivot is \\(\\frac{1}{3}ML^2\\). Find \\(\\omega\\).",
    optionA: "\\(\\sqrt{\\frac{3g}{L}}\\)",
    optionB: "\\(\\sqrt{\\frac{g}{L}}\\)",
    optionC: "\\(\\sqrt{\\frac{2g}{L}}\\)",
    optionD: "\\(\\sqrt{\\frac{6g}{L}}\\)",
  }),
  longOptions: q({
    questionText: "Which of the following statements about a body moving in uniform circular motion is correct?",
    optionA: "Its speed stays the same, but its velocity keeps changing because the direction of motion changes at every instant",
    optionB: "Its acceleration is directed towards the centre of the circle, and its magnitude is v squared divided by the radius",
    optionC: "The net force on the body does no work over a complete revolution, so its kinetic energy does not change at all",
    optionD: "Its angular momentum about the centre of the circle stays constant, because the net force passes through the centre",
  }),
  long: q({
    questionText: statements(9),
    optionA: "Only statements 1 and 2 are correct",
    optionB: "Only statements 3 and 4 are correct",
    optionC: "All the statements are correct",
    optionD: "None of the statements is correct",
  }),
  veryLong: q({
    questionText: statements(40),
    optionA: "Only statements 1 and 2 are correct",
    optionB: "Only statements 3 and 4 are correct",
    optionC: "All the statements are correct",
    optionD: "None of the statements is correct",
  }),
  latex: q({
    questionText: "If \\(f(x) = \\dfrac{x^2 - 1}{x + 1}\\), find \\(\\lim_{x \\to -1} f(x)\\) given \\[\\int_0^1 x^2\\,dx = \\frac{1}{3}\\]",
    optionA: "\\(-2\\)",
    optionB: "\\(0\\)",
    optionC: "\\(\\sqrt{2}\\)",
    optionD: "\\(\\infty\\)",
  }),
  wideEquation: q({
    questionText:
      "Evaluate \\[\\left(\\frac{a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12}}{b_1 + b_2 + b_3 + b_4 + b_5 + b_6 + b_7 + b_8 + b_9 + b_{10} + b_{11} + b_{12}}\\right)^{n}\\] for the given sequences.",
    optionA: "\\(1\\)",
    optionB: "\\(n\\)",
    optionC: "\\(2n\\)",
    optionD: "\\(n^2\\)",
  }),
  diagram: q({
    questionText: "The circuit shown in the figure has a 6 V battery and three identical resistors. Find the current through the battery.",
    optionA: "0.5 A",
    optionB: "1 A",
    optionC: "1.5 A",
    optionD: "2 A",
    diagramUrls: ["https://example.invalid/circuit.svg"],
  }),
  optionFigures: q({
    questionText: "Which graph shows the velocity of a body thrown straight up?",
    optionDiagramUrls: {
      A: ["https://example.invalid/opt-a.svg"],
      B: ["https://example.invalid/opt-b.svg"],
      C: ["https://example.invalid/opt-c.svg"],
      D: ["https://example.invalid/opt-d.svg"],
    },
  }),
  numerical: q({ questionText: "A car covers 120 km in 2 h. Find its average speed in km/h.", answerType: "Numerical" }),
};
const NAMES = Object.keys(S) as (keyof typeof S)[];
const indexOf = (name: keyof typeof S) => NAMES.indexOf(name);

const paperOf = (questions: PaperQuestion[], slides: SmartSlideSettings = DEFAULT_SMART_SLIDE_SETTINGS): QuestionPaper => ({
  title: "Laws of Motion",
  institute: "Sunrise Classes",
  standard: "11th",
  subject: "Physics",
  questions,
  marksPerQuestion: 4,
  paperSet: "1",
  date: "",
  durationMinutes: null,
  questionPaper: true,
  answerKey: false,
  solutions: false,
  strictLayout: false,
  format: "smart",
  slides,
});

/** Lays the slides out in Chrome without printing a PDF. */
async function measure(questions: PaperQuestion[], settings: SmartSlideSettings = DEFAULT_SMART_SLIDE_SETTINGS) {
  return renderSlides(smartSlidesHtml(paperOf(questions, settings), FIGURES), settings, 60000, { print: false });
}

const errorsOf = (fit: SlideFitResult) => fit.issues.filter((issue) => issue.severity === "error");

describe("smart slide settings", () => {
  test("defaults: Dark Board, 30% question area, medium text, auto options, institute shown", () => {
    assert.deepEqual(normalizeSlideSettings(undefined), DEFAULT_SMART_SLIDE_SETTINGS);
    assert.equal(DEFAULT_SMART_SLIDE_SETTINGS.theme, "dark");
  });

  test("bad or out-of-range values fall back or are clamped to 25–50%", () => {
    const s = normalizeSlideSettings({ theme: "pink", questionAreaPct: 90, fontSize: "huge", mcqLayout: "grid", showInstitute: false });
    assert.deepEqual(s, { theme: "dark", questionAreaPct: 50, fontSize: "medium", mcqLayout: "grid", showInstitute: false });
    assert.equal(normalizeSlideSettings({ questionAreaPct: 3 }).questionAreaPct, 25);
    assert.equal(normalizeSlideSettings({ questionAreaPct: 37 }).questionAreaPct, 35);
  });

  test("saved settings round-trip through JSON; keys are per account", () => {
    const saved: SmartSlideSettings = { theme: "green", questionAreaPct: 40, fontSize: "large", mcqLayout: "vertical", showInstitute: false };
    assert.deepEqual(normalizeSlideSettings(JSON.parse(JSON.stringify(saved))), saved);
    assert.notEqual(slidePrefsKey("64b7f0c2a1b2c3d4e5f60718"), slidePrefsKey("64b7f0c2a1b2c3d4e5f60719"));
    assert.match(slidePrefsKey("a b/c"), /^[A-Za-z0-9._-]+$/);
  });

  test("text is never set smaller than 80% of the chosen size, nor under the minimum", () => {
    for (const px of Object.values(FONT_PX)) {
      assert.ok(minFontPx(px) >= MIN_FONT_PX);
      assert.ok(minFontPx(px) >= px * 0.8);
    }
  });
});

describe("parsing a Smart PDF request", () => {
  test("format smart prints questions only, never an answer key or solutions", () => {
    const paper = parsePaper({ format: "smart", slides: { theme: "white" }, marksPerQuestion: 4, answerKey: true, solutions: true, questions: [S.short] });
    assert.equal(paper.format, "smart");
    assert.equal(paper.slides?.theme, "white");
    assert.equal(paper.answerKey, false);
    assert.equal(paper.solutions, false);
    assert.equal(paper.questionPaper, true);
  });

  test("a request without format is the exam paper, as before", () => {
    const paper = parsePaper({ marksPerQuestion: 4, answerKey: true, questions: [S.short] });
    assert.equal(paper.format, undefined);
    assert.equal(paper.slides, undefined);
    assert.equal(paper.answerKey, true);
  });
});

describe("slide HTML", () => {
  const html = smartSlidesHtml(paperOf(Object.values(S)), FIGURES);

  test("16:9 pages, the institute's name, no answers, solutions or watermark", () => {
    assert.match(html, /@page \{ size: 960px 540px; margin: 0; \}/);
    assert.ok(html.includes("Sunrise Classes"));
    assert.ok(!html.includes("worked solution"));
    assert.ok(!/watermark|Correct Answer|Answer Key/i.test(html));
  });

  test("hiding the institute leaves it out; each theme sets its own board colour", () => {
    assert.ok(!smartSlidesHtml(paperOf([S.short], { ...DEFAULT_SMART_SLIDE_SETTINGS, showInstitute: false }), new Map()).includes("Sunrise Classes"));
    assert.ok(smartSlidesHtml(paperOf([S.short], { ...DEFAULT_SMART_SLIDE_SETTINGS, theme: "white" }), new Map()).includes("background: #FFFFFF"));
    assert.ok(smartSlidesHtml(paperOf([S.short], { ...DEFAULT_SMART_SLIDE_SETTINGS, theme: "green" }), new Map()).includes("background: #24392C"));
  });

  test("the stem as words prints the same as richText, and never cuts inside maths", () => {
    for (const question of Object.values(S)) {
      const tokens = richTokens(question.questionText);
      const joined = tokens.map((t) => t.html + (t.after === " " ? " " : "<br>".repeat(t.after.length))).join("");
      assert.equal(joined.replace(/\s+/g, " ").trim(), richText(question.questionText).replace(/\s+/g, " ").trim());
      for (const t of tokens) assert.equal((t.html.match(/<math/g) ?? []).length, (t.html.match(/<\/math>/g) ?? []).length);
    }
  });
});

describe("slide layout, measured in Chrome", { skip: !haveChrome && "Chrome isn't installed" }, () => {
  const all = Object.values(S);

  for (const [pct, fontSize] of [[25, "medium"], [30, "medium"], [50, "medium"], [30, "large"], [30, "small"]] as const) {
    test(`${pct}% area, ${fontSize} text: every question laid out on its own terms`, { timeout: 60000 }, async () => {
      const settings: SmartSlideSettings = { ...DEFAULT_SMART_SLIDE_SETTINGS, questionAreaPct: pct, fontSize };
      const { fit, pdf } = await measure(all, settings);
      assert.equal(pdf, null, "measuring prints nothing");
      assert.deepEqual(errorsOf(fit), []);
      const g = slideGeometry(settings);
      const plan = (name: keyof typeof S) => fit.plan[indexOf(name)];
      assert.equal(fit.plan.length, all.length);

      // Short: the area as set, writing space below.
      assert.equal(plan("short").kind, "short");
      assert.equal(plan("short").areaPx, g.regionHeight);
      assert.equal(plan("short").optionLayout, "horizontal");
      assert.equal(plan("numerical").kind, "short");

      for (const entry of fit.plan) {
        // No question's area is smaller than the teacher's preference.
        assert.ok(entry.areaPx >= g.regionHeight, `Q${entry.q} area ${entry.areaPx} ≥ ${g.regionHeight}`);
        // Medium keeps real writing space; full gets the whole slide and a blank slide after.
        if (entry.kind === "medium") assert.ok(entry.areaPx <= SLIDE.height * MEDIUM_MAX_SHARE + 1, `Q${entry.q} medium leaves room to write`);
        if (entry.kind === "full") assert.equal(entry.areaPx, SLIDE.height);
        assert.equal(entry.blankAfter, entry.kind === "full" || (entry.kind === "continued" && entry.areaPx === SLIDE.height));
        // Text is never made smaller than allowed.
        assert.ok(entry.fontPx >= minFontPx(g.fontPx) && entry.fontPx <= g.fontPx);
        // Questions that fit one slide stay on one slide, options included.
        if (entry.q - 1 !== indexOf("veryLong")) assert.equal(entry.parts, 1, `Q${entry.q} is on one slide`);
      }
      // Long options don't split: the area grows instead.
      assert.notEqual(plan("longOptions").kind, "short");
      // The figure is shown at its readable size: the area grows when the preferred one is too small for it.
      if (g.contentHeight < FIGURE_PX) assert.notEqual(plan("diagram").kind, "short", "the area grows to show the figure");
      // A question too long for any slide continues, its options together on the last part.
      assert.equal(plan("veryLong").kind, "continued");
      assert.ok(plan("veryLong").parts >= 2 && plan("veryLong").parts <= 6);
      // Slides: every part, plus a writing slide after each full one.
      const parts = fit.plan.reduce((n, e) => n + e.parts + (e.blankAfter ? 1 : 0), 0);
      assert.equal(fit.stats.slides, parts);
      assert.equal(fit.stats.blank, fit.plan.filter((e) => e.blankAfter).length);
    });
  }

  test("a chosen options layout is kept; the themes give the same layout", { timeout: 60000 }, async () => {
    for (const mcqLayout of ["horizontal", "grid", "vertical"] as const) {
      const { fit } = await measure([S.short, S.longOptions], { ...DEFAULT_SMART_SLIDE_SETTINGS, mcqLayout });
      assert.deepEqual(errorsOf(fit), []);
      assert.deepEqual(fit.plan.map((e) => e.optionLayout), [mcqLayout, mcqLayout]);
    }
    const plans = [];
    for (const theme of ["dark", "green", "white"] as const) plans.push((await measure(all, { ...DEFAULT_SMART_SLIDE_SETTINGS, theme })).fit.plan);
    assert.deepEqual(plans[1], plans[0]);
    assert.deepEqual(plans[2], plans[0]);
  });

  test("content that can't be shown legibly is refused at once, nothing printed", { timeout: 60000 }, async () => {
    const huge = q({ questionText: "W".repeat(6000), optionA: "1", optionB: "2", optionC: "3", optionD: "4" });
    const started = Date.now();
    const { fit, pdf, ms } = await renderSlides(smartSlidesHtml(paperOf([S.short, huge]), new Map()), DEFAULT_SMART_SLIDE_SETTINGS);
    assert.equal(pdf, null);
    assert.equal(ms.pdf, 0);
    assert.ok(errorsOf(fit).some((issue) => issue.where === "Question 2"));
    assert.ok(!errorsOf(fit).some((issue) => issue.where === "Question 1"));
    assert.ok(Date.now() - started < 15000, `refused in ${Date.now() - started} ms`);
  });
});

describe("one mixed Smart PDF, printed and read back", { skip: !haveChrome && "Chrome isn't installed" }, () => {
  test("pages match the measured slides; options together; writing slides blank; nothing off the page", { timeout: 90000 }, async () => {
    const settings = DEFAULT_SMART_SLIDE_SETTINGS;
    const questions = Object.values(S);
    const { pdf, fit, ms } = await renderSlides(smartSlidesHtml(paperOf(questions, settings), FIGURES), settings);
    assert.deepEqual(errorsOf(fit), []);
    assert.ok(pdf, "printed");
    console.log(
      `[smart-pdf test] ${questions.length} questions → ${fit.stats.slides} slides ` +
        `(${fit.stats.short} short, ${fit.stats.medium} medium, ${fit.stats.full} full, ${fit.stats.continued} continued, ${fit.stats.blank} writing); ` +
        `ms ${JSON.stringify(ms)}; plan ${fit.plan.map((e) => `Q${e.q}:${e.kind}${e.parts > 1 ? "×" + e.parts : ""}${e.blankAfter ? "+blank" : ""}`).join(" ")}`
    );

    // The page each slide should print on, from the measured plan.
    const expected: { q: number; part: number; parts: number; blank: boolean; areaPx: number }[] = [];
    for (const e of fit.plan) {
      for (let part = 1; part <= e.parts; part++) expected.push({ q: e.q, part, parts: e.parts, blank: false, areaPx: part === e.parts ? e.areaPx : SLIDE.height });
      if (e.blankAfter) expected.push({ q: e.q, part: 0, parts: e.parts, blank: true, areaPx: 0 });
    }

    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(pdf!), useSystemFonts: true });
    const doc = await task.promise;
    assert.equal(doc.numPages, expected.length, "one page per measured slide, nothing more");
    const toPt = 72 / 96;
    const optionPages = new Map<number, number[]>();
    for (let n = 1; n <= doc.numPages; n++) {
      const want = expected[n - 1];
      const page = await doc.getPage(n);
      const [, , width, height] = page.view;
      // Exactly the slide's size: Chrome didn't scale anything to fit.
      assert.ok(Math.abs(width - SLIDE.width * toPt) < 0.5 && Math.abs(height - SLIDE.height * toPt) < 0.5, `page ${n} is ${width}×${height}`);
      const texts = (await page.getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => "str" in item && !!item.str.trim());
      const { fnArray } = await page.getOperatorList();
      const images = fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject).length;
      if (want.blank) {
        assert.equal(texts.length, 0, `page ${n} is a blank writing slide`);
        assert.equal(images, 0, `page ${n} is a blank writing slide`);
        continue;
      }
      const all = texts.map((t) => t.str).join(" ");
      const label = want.parts > 1 ? `Q${want.q}${want.part > 1 ? " (continued)" : ""} · ${want.part}/${want.parts}` : `Q${want.q}`;
      assert.ok(all.includes(label), `page ${n} is labelled "${label}"`);
      for (const t of texts) {
        const x = t.transform[4];
        const fromTop = height - t.transform[5];
        assert.ok(x >= -0.5 && x + t.width <= width + 0.5 && fromTop >= 0 && fromTop <= height + 0.5, `page ${n}: "${t.str.slice(0, 30)}" is on the page`);
        // Nothing in the writing space below the question area.
        assert.ok(fromTop <= want.areaPx * toPt + 1, `page ${n}: "${t.str.slice(0, 30)}" is above the writing space`);
      }
      const marks = texts.filter((t) => /^\([A-D]\)$/.test(t.str.trim())).map((t) => t.str.trim());
      if (marks.length) optionPages.set(want.q, [...(optionPages.get(want.q) ?? []), n]);
      if (marks.length) assert.deepEqual(marks.sort(), ["(A)", "(B)", "(C)", "(D)"], `page ${n}: all four options together`);
    }
    // Every MCQ's options are on exactly one page; a numerical question has none.
    questions.forEach((question, i) => {
      const pages = optionPages.get(i + 1) ?? [];
      assert.equal(pages.length, question.answerType === "Numerical" ? 0 : 1, `Q${i + 1}'s options are on one page`);
    });
    await task.destroy();
  });
});
