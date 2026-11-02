// Smart PDF tests: the slide layout rules, request parsing, and real slides
// printed with the local Chrome (skipped without it): a short MCQ, a long
// question, a LaTeX question and one with a diagram, checking that each
// question stays in its area and the writing space below is blank.
// Run with: npx tsx --test tests/smart-pdf.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, describe, test } from "node:test";
import { loadPdfjs } from "@/lib/pdfjsNode";
import type { PaperQuestion, QuestionPaper } from "@/lib/questionPaper/html";
import { parsePaper } from "@/lib/questionPaper/parse";
import { renderSlides, setBrowserLauncherForTests } from "@/lib/questionPaper/render";
import { smartSlidesHtml } from "@/lib/smartSlides/html";
import {
  DEFAULT_SMART_SLIDE_SETTINGS,
  normalizeSlideSettings,
  planQuestionSlides,
  SLIDE,
  slideGeometry,
  slidePrefsKey,
  stemPieces,
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

const FIGURE_URL = "https://example.invalid/figure.png";
// A 1 × 1 PNG, drawn at the figure's size.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SAMPLES = {
  short: q({ questionText: "The SI unit of force is", optionA: "Newton", optionB: "Joule", optionC: "Watt", optionD: "Pascal" }),
  long: q({
    questionText: Array.from(
      { length: 14 },
      (_, i) => `Statement ${i + 1}: a block of mass m slides down a rough incline of angle theta with coefficient of friction mu, starting from rest at the top.`
    ).join(" "),
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
  longOptions: q({
    questionText: "Which of the following statements about a body moving in uniform circular motion is correct?",
    optionA: "Its speed stays the same, but its velocity keeps changing because the direction of motion changes at every instant",
    optionB: "Its acceleration is directed towards the centre of the circle, and its magnitude is v squared divided by the radius",
    optionC: "The net force on the body does no work over a complete revolution, so its kinetic energy does not change at all",
    optionD: "Its angular momentum about the centre of the circle stays constant, because the net force passes through the centre",
  }),
  diagram: q({
    questionText: "The circuit shown in the figure has a 6 V battery and three identical resistors. Find the current through the battery.",
    optionA: "0.5 A",
    optionB: "1 A",
    optionC: "1.5 A",
    optionD: "2 A",
    diagramUrls: [FIGURE_URL],
  }),
};

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
  strictLayout: true,
  format: "smart",
  slides,
});

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

  test("the writing area is 50–75% of the slide", () => {
    for (const pct of [25, 30, 50]) {
      const g = slideGeometry({ ...DEFAULT_SMART_SLIDE_SETTINGS, questionAreaPct: pct });
      assert.equal(g.regionHeight, Math.round((SLIDE.height * pct) / 100));
    }
  });
});

describe("planning slides", () => {
  test("a short MCQ is one slide, options in one row", () => {
    const plan = planQuestionSlides(SAMPLES.short, DEFAULT_SMART_SLIDE_SETTINGS);
    assert.equal(plan.parts.length, 1);
    assert.equal(plan.mcqLayout, "horizontal");
    assert.ok(plan.parts[0].options);
  });

  test("a long question continues on more slides; the options go on the last", () => {
    const plan = planQuestionSlides(SAMPLES.long, DEFAULT_SMART_SLIDE_SETTINGS);
    assert.ok(plan.parts.length > 1);
    assert.ok(plan.parts.slice(1).every((part) => part.continued));
    assert.ok(plan.parts.at(-1)!.options);
    assert.ok(plan.parts.slice(0, -1).every((part) => !part.options));
  });

  test("options stay together when they fit, and split by rows onto continuation slides when they can't", () => {
    for (const questionAreaPct of [25, 30, 40, 50]) {
      const settings = { ...DEFAULT_SMART_SLIDE_SETTINGS, questionAreaPct };
      const plan = planQuestionSlides(SAMPLES.longOptions, settings);
      // Every option once, in order, each on one slide.
      assert.deepEqual(plan.parts.flatMap((part) => part.optionKeys), ["A", "B", "C", "D"]);
      assert.ok(plan.parts.slice(1).every((part) => part.continued));
      assert.ok(!plan.tight, `${questionAreaPct}%: every slide's share fits`);
    }
    // At 25% the four long options can't share one slide: they are split between slides.
    const small = planQuestionSlides(SAMPLES.longOptions, { ...DEFAULT_SMART_SLIDE_SETTINGS, questionAreaPct: 25 });
    assert.ok(small.parts.filter((part) => part.options).length > 1);
    assert.equal(planQuestionSlides(SAMPLES.short, DEFAULT_SMART_SLIDE_SETTINGS).parts[0].optionKeys.length, 4);
  });

  test("a chosen options layout is used as is", () => {
    for (const mcqLayout of ["horizontal", "grid", "vertical"] as const) {
      assert.equal(planQuestionSlides(SAMPLES.short, { ...DEFAULT_SMART_SLIDE_SETTINGS, mcqLayout }).mcqLayout, mcqLayout);
    }
  });

  test("maths is never cut between slides", () => {
    const text = "Find \\(a. b\\) if \\(x = 1. 5\\). Then evaluate \\[y. z\\]. Done.";
    for (const piece of stemPieces(text)) {
      assert.equal((piece.match(/\\\(/g) ?? []).length, (piece.match(/\\\)/g) ?? []).length, piece);
      assert.equal((piece.match(/\\\[/g) ?? []).length, (piece.match(/\\\]/g) ?? []).length, piece);
    }
  });

  test("a figure sits beside the text on the first slide", () => {
    const plan = planQuestionSlides(SAMPLES.diagram, DEFAULT_SMART_SLIDE_SETTINGS);
    assert.ok(plan.figureWidth > 0);
    assert.ok(plan.parts[0].figures);
  });
});

describe("parsing a Smart PDF request", () => {
  test("format smart prints questions only, never an answer key or solutions", () => {
    const paper = parsePaper({
      format: "smart",
      slides: { theme: "white" },
      marksPerQuestion: 4,
      answerKey: true,
      solutions: true,
      questions: [SAMPLES.short],
    });
    assert.equal(paper.format, "smart");
    assert.equal(paper.slides?.theme, "white");
    assert.equal(paper.answerKey, false);
    assert.equal(paper.solutions, false);
    assert.equal(paper.questionPaper, true);
  });

  test("a request without format is the exam paper, as before", () => {
    const paper = parsePaper({ marksPerQuestion: 4, answerKey: true, questions: [SAMPLES.short] });
    assert.equal(paper.format, undefined);
    assert.equal(paper.slides, undefined);
    assert.equal(paper.answerKey, true);
  });
});

describe("slide HTML", () => {
  const html = smartSlidesHtml(paperOf(Object.values(SAMPLES)), new Map([[FIGURE_URL, PNG]]));

  test("16:9 pages, the institute's name, no answers, solutions or watermark", () => {
    assert.match(html, /@page \{ size: 960px 540px; margin: 0; \}/);
    assert.ok(html.includes("Sunrise Classes"));
    assert.ok(!html.includes("worked solution"));
    assert.ok(!/watermark|Correct Answer|Answer Key/i.test(html));
  });

  test("hiding the institute leaves it out", () => {
    const hidden = smartSlidesHtml(paperOf([SAMPLES.short], { ...DEFAULT_SMART_SLIDE_SETTINGS, showInstitute: false }), new Map());
    assert.ok(!hidden.includes("Sunrise Classes"));
  });

  test("each theme sets its own board colour", () => {
    const white = smartSlidesHtml(paperOf([SAMPLES.short], { ...DEFAULT_SMART_SLIDE_SETTINGS, theme: "white" }), new Map());
    assert.ok(white.includes("background: #FFFFFF"));
  });
});

describe("printed slides", { skip: !haveChrome && "Chrome isn't installed" }, () => {
  for (const pct of [25, 30, 50]) {
    test(`all four samples print within a ${pct}% question area, the rest blank`, { timeout: 60000 }, async () => {
      const settings = { ...DEFAULT_SMART_SLIDE_SETTINGS, questionAreaPct: pct };
      const paper = paperOf(Object.values(SAMPLES), settings);
      const expectedSlides = paper.questions.reduce((n, question) => n + planQuestionSlides(question, settings).parts.length, 0);
      const { pdf, fit } = await renderSlides(smartSlidesHtml(paper, new Map([[FIGURE_URL, PNG]])));
      assert.deepEqual(fit.issues, []);
      assert.equal(fit.stats.slides, expectedSlides);

      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
      const doc = await task.promise;
      assert.equal(doc.numPages, expectedSlides);
      const toPt = 72 / 96;
      const regionPt = slideGeometry(settings).regionHeight * toPt;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const [, , width, height] = page.view;
        assert.ok(Math.abs(width / height - 16 / 9) < 0.01, `page ${n} is 16:9`);
        const content = await page.getTextContent();
        const texts = content.items.filter((item) => "str" in item && item.str.trim());
        assert.ok(texts.length > 0, `page ${n} has the question`);
        for (const item of texts) {
          if (!("str" in item)) continue;
          // PDF y runs up from the bottom: the text's baseline must be inside the top area.
          const fromTop = height - item.transform[5];
          assert.ok(fromTop <= regionPt + 1, `page ${n}: "${item.str.slice(0, 30)}" is in the writing area`);
        }
        // Figures too: every image's lowest corner stays inside the top area.
        const { fnArray, argsArray } = await page.getOperatorList();
        let ctm = [1, 0, 0, 1, 0, 0];
        const saved: number[][] = [];
        for (let i = 0; i < fnArray.length; i++) {
          const fn = fnArray[i];
          if (fn === pdfjs.OPS.save) saved.push(ctm);
          else if (fn === pdfjs.OPS.restore) ctm = saved.pop() ?? ctm;
          else if (fn === pdfjs.OPS.transform) {
            const [a, b, c, d, e, f] = argsArray[i] as number[];
            const [A, B, C, D, E, F] = ctm;
            ctm = [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
          } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
            const lowest = Math.min(ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]);
            assert.ok(height - lowest <= regionPt + 1, `page ${n}: a figure is in the writing area`);
          }
        }
      }
      await task.destroy();
    });
  }

  test("a question that can't fit even with smaller text is reported, not printed cut off", { timeout: 60000 }, async () => {
    // One word far too long to break: no continuation can help.
    const huge = q({ questionText: `${"W".repeat(3000)}`, optionA: "1", optionB: "2", optionC: "3", optionD: "4" });
    const { fit } = await renderSlides(smartSlidesHtml(paperOf([huge]), new Map()));
    assert.ok(fit.issues.some((issue) => issue.kind === "slide-overflow" && issue.where === "Question 1"));
  });
});
