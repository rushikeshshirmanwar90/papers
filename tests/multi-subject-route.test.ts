// POST /api/question-paper-pdf with multi-subject papers, as the Expo app sends
// them (pcmb-paper/src/services/question-pdf.ts requestBody): real route, real
// Chrome, a throwaway in-memory MongoDB, synthetic questions. This proves the
// backend half only; it does not exercise the mobile app.
// Run with: npx tsx --test tests/multi-subject-route.test.ts
// Set PAPER_SAMPLES_DIR to keep the PDFs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const JWT_SECRET = "multi-subject-route-jwt-secret-0123456789abcdef";
const BASE = "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);
const SAMPLES = process.env.PAPER_SAMPLES_DIR;

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;
let token = "";

async function load() {
  const [pdfRoute, render, auth, db] = await Promise.all([
    import("@/app/api/question-paper-pdf/route"),
    import("@/lib/questionPaper/render"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return { pdfRoute, render, auth, db, Tuition: (await import("@/models/Tuition")).default, User: (await import("@/models/User")).default };
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "multi_subject_route_test";
  process.env.JWT_SECRET = JWT_SECRET;
  m = await load();
  await m.db.connectDB();
  const tuition = await m.Tuition.create({ name: "DEVNE CLASSES" });
  const teacher = await m.User.create({ email: "teacher@test.local", name: "T", passwordHash: "x", role: "teacher", tuitionId: tuition._id, emailVerified: true });
  token = await m.auth.signToken(teacher);
});

after(async () => {
  await m?.render.setBrowserLauncherForTests(null);
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

/** A question as the app sends it. */
const q = (subject: string, n: number, over: Record<string, unknown> = {}) => ({
  subject,
  topic: "",
  questionText: `${subject} item ${n} stem`,
  optionA: "alpha",
  optionB: "beta",
  optionC: "gamma",
  optionD: "delta",
  answerType: "MCQ",
  correctAnswer: "ABCD"[n % 4],
  explanation: `${subject} worked solution ${n}`,
  chapter: "Mixed",
  source: "",
  diagramUrls: [],
  optionDiagramUrls: { A: [], B: [], C: [], D: [] },
  explanationDiagramUrls: [],
  ...over,
});
const many = (subject: string, count: number) => Array.from({ length: count }, (_, i) => q(subject, i + 1));

type Content = "questions" | "answerKey" | "withKey" | "withSolutions" | "keyAndSolutions";
const SECTIONS: Record<Content, Record<string, boolean>> = {
  questions: { questionPaper: true, answerKey: false, solutions: false },
  answerKey: { questionPaper: false, answerKey: true, solutions: false },
  withKey: { questionPaper: true, answerKey: true, solutions: false },
  withSolutions: { questionPaper: true, answerKey: false, solutions: true },
  keyAndSolutions: { questionPaper: true, answerKey: true, solutions: true },
};

/** services/question-pdf.ts requestBody: what the header says and what each question carries. */
function examBody(questions: ReturnType<typeof q>[], subject: string, content: Content, extra: Record<string, unknown> = {}) {
  return {
    title: "JEE MAIN MOCK TEST",
    standard: "12th",
    subject,
    marksPerQuestion: 4,
    paperSet: "1",
    date: "2026-08-30",
    durationMinutes: 180,
    ...SECTIONS[content],
    style: { fontFamily: "noto-sans", fontSize: "medium", columns: 2, spacing: "normal", watermarkOpacity: "medium", logo: false },
    questions,
    ...extra,
  };
}

function smartBody(questions: ReturnType<typeof q>[], subject: string, slides: Record<string, unknown> = {}) {
  return {
    title: "Live class",
    standard: "12th",
    subject,
    marksPerQuestion: 0,
    questionPaper: true,
    answerKey: false,
    solutions: false,
    format: "smart",
    slides: { theme: "dark", questionAreaPct: 30, fontSize: "medium", mcqLayout: "auto", showInstitute: true, fontFamily: "noto-sans", ...slides },
    questions,
  };
}

function post(body: unknown) {
  const req = new NextRequest(`${BASE}/api/question-paper-pdf`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return m.pdfRoute.POST(req, {});
}

async function pdfOf(body: unknown, name: string): Promise<Uint8Array> {
  const res = await post(body);
  assert.equal(res.status, 200, `HTTP ${res.status}: ${res.status === 200 ? "" : await res.text()}`);
  assert.match(res.headers.get("content-type") ?? "", /application\/pdf/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  if (SAMPLES) {
    mkdirSync(SAMPLES, { recursive: true });
    writeFileSync(`${SAMPLES}/${name}.pdf`, bytes);
  }
  return bytes;
}

async function pagesOf(pdf: Uint8Array): Promise<string[]> {
  const { loadPdfjs } = await import("@/lib/pdfjsNode");
  const doc = await (await loadPdfjs()).getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items;
    pages.push(items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return pages;
}

const SUBJECTS3 = "Physics, Chemistry, Mathematics";
const three = () => [...many("Physics", 6), ...many("Chemistry", 5), ...many("Mathematics", 4)];

describe("Exam PDF through the route", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  test("single subject: its own layout, no subject headings, every question once", { timeout: 120000 }, async () => {
    const pages = await pagesOf(await pdfOf(examBody(many("Physics", 6), "Physics", "questions"), "exam-single"));
    const text = pages.join(" ");
    assert.match(text, /DEVNE CLASSES/);
    assert.match(text, /Subject\s*: Physics/);
    assert.match(text, /Total Mark\s*: 24/);
    assert.doesNotMatch(text, /\d+ Questions/);
    for (let i = 1; i <= 6; i++) assert.equal((text.match(new RegExp(`Physics item ${i} stem`, "g")) ?? []).length, 1);
  });

  test("two subjects", { timeout: 120000 }, async () => {
    const questions = [...many("Physics", 4), ...many("Biology", 3)];
    const text = (await pagesOf(await pdfOf(examBody(questions, "Physics, Biology", "questions"), "exam-two"))).join(" ");
    assert.match(text, /PHYSICS\s+4 Questions/);
    assert.match(text, /BIOLOGY\s+3 Questions/);
    assert.match(text, /Total Mark\s*: 28/);
    assert.ok(text.indexOf("PHYSICS") < text.indexOf("BIOLOGY"));
  });

  test("three subjects, questions only: headings in order, numbered 1..15, no key or solutions", { timeout: 120000 }, async () => {
    const text = (await pagesOf(await pdfOf(examBody(three(), SUBJECTS3, "questions"), "exam-three-questions"))).join(" ");
    const at = ["PHYSICS", "CHEMISTRY", "MATHEMATICS"].map((s) => text.indexOf(s));
    assert.ok(at[0] > -1 && at[0] < at[1] && at[1] < at[2]);
    for (let n = 1; n <= 15; n++) assert.match(text, new RegExp(`\\(${n}\\)`));
    assert.doesNotMatch(text, /Answer Key|Solution:/);
  });

  test("questions + answer key: a table per subject with each question's own answer", { timeout: 120000 }, async () => {
    const pages = await pagesOf(await pdfOf(examBody(three(), SUBJECTS3, "withKey"), "exam-three-key"));
    const key = pages.find((p) => /Answer Key/.test(p))!;
    assert.ok(key);
    for (const s of ["PHYSICS", "CHEMISTRY", "MATHEMATICS"]) assert.match(key, new RegExp(s));
    // Question 1 is Physics 1 (answer ABCD[1] = B); question 7 is Chemistry 1 (B); question 12 is Mathematics 1 (B).
    assert.match(key, /1 - B/);
    assert.match(key, /7 - B/);
    assert.match(key, /12 - B/);
    assert.match(key, /6 - C/, "Physics 6 -> ABCD[6 % 4] = C");
    assert.doesNotMatch(key, /SECTION/i);
  });

  test("questions + solutions: subject headings, numbers and answers match", { timeout: 120000 }, async () => {
    const text = (await pagesOf(await pdfOf(examBody(three(), SUBJECTS3, "withSolutions"), "exam-three-solutions"))).join(" ");
    assert.equal((text.match(/Solution:\(Correct Answer:/g) ?? []).length, 15);
    assert.match(text, /Physics worked solution 6/);
    assert.match(text, /Mathematics worked solution 4/);
    assert.equal((text.match(/PHYSICS/g) ?? []).length, 2, "one heading in the questions, one in the solutions");
  });

  test("separate answer key: key only, no question text", { timeout: 120000 }, async () => {
    const text = (await pagesOf(await pdfOf(examBody(three(), SUBJECTS3, "answerKey"), "exam-three-key-only"))).join(" ");
    assert.match(text, /Answer Key/);
    assert.match(text, /CHEMISTRY/);
    assert.doesNotMatch(text, /item \d+ stem/);
  });

  test("everything on: key and solutions, long equations, a figure that can't load, a blank explanation", { timeout: 120000 }, async () => {
    const chain =
      "\\[ F = qE = q\\frac{V}{d} = \\frac{q\\sigma}{\\epsilon_0} = \\frac{qQ}{\\epsilon_0 A} = \\frac{1}{4\\pi\\epsilon_0}\\frac{qQ}{r^2} = 9\\times10^{9}\\times\\frac{1.6\\times10^{-19}\\times 3.2\\times10^{-19}}{(10^{-10})^2} \\]";
    const questions = [
      q("Physics", 1, { questionText: `Physics item 1 stem ${chain}` }),
      q("Physics", 2, { explanation: "" }),
      q("Chemistry", 1, { diagramUrls: ["https://example.invalid/missing.png"] }),
      q("Mathematics", 1, { answerType: "Numerical", correctAnswer: "42", optionA: "", optionB: "", optionC: "", optionD: "" }),
    ];
    const res = await post(examBody(questions, SUBJECTS3, "keyAndSolutions"));
    assert.equal(res.status, 200);
    const pages = await pagesOf(new Uint8Array(await res.arrayBuffer()));
    const text = pages.join(" ");
    assert.match(text, /worked solution isn't in the question bank/);
    assert.match(text, /4 - 42/);
  });

  test("a header list cut to fit ('A, B +N more') never decides the order; the questions' order does", { timeout: 120000 }, async () => {
    const questions = [...many("Chemistry", 2), ...many("Physics", 2), ...many("Mathematics", 2)];
    const text = (await pagesOf(await pdfOf(examBody(questions, "Physics, Chemistry +1 more", "withKey"), "exam-truncated-header"))).join(" ");
    assert.ok(text.indexOf("CHEMISTRY") < text.indexOf("PHYSICS") && text.indexOf("PHYSICS") < text.indexOf("MATHEMATICS"));
  });

  test("a header subject over 80 characters is still refused (the app shortens it first)", async () => {
    const res = await post(examBody(many("Physics", 1), "x".repeat(81), "questions"));
    assert.equal(res.status, 400);
  });
});

describe("Smart PDF through the route", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  test("single subject: one slide per question, labelled", { timeout: 120000 }, async () => {
    const pages = await pagesOf(await pdfOf(smartBody(many("Physics", 3), "Physics"), "smart-single"));
    assert.equal(pages.length, 3);
    pages.forEach((page, i) => {
      assert.match(page, new RegExp(`Q${i + 1}`));
      assert.match(page, /PHYSICS/);
      assert.match(page, /DEVNE CLASSES/);
    });
  });

  test("three subjects: order, numbering, a label per slide, all options on the slide, no divider slides", { timeout: 120000 }, async () => {
    const pages = await pagesOf(await pdfOf(smartBody(three(), SUBJECTS3), "smart-three"));
    assert.equal(pages.length, 15, "one slide per short question; no divider or extra slides");
    const want = [...Array(6).fill("PHYSICS"), ...Array(5).fill("CHEMISTRY"), ...Array(4).fill("MATHEMATICS")];
    pages.forEach((page, i) => {
      assert.match(page, new RegExp(`Q${i + 1}\\b`));
      assert.match(page, new RegExp(want[i]));
      for (const key of ["(A)", "(B)", "(C)", "(D)"]) assert.ok(page.includes(key), `slide ${i + 1} has ${key}`);
      assert.doesNotMatch(page, /Solution|Answer Key/);
    });
  });

  test("manual order in the header, another theme and layout; a long question gets a blank solving slide", { timeout: 120000 }, async () => {
    const long = q("Chemistry", 9, {
      questionText: Array.from({ length: 12 }, (_, i) => `Statement ${i + 1}: a block of mass m slides down a rough incline of angle theta with friction, starting from rest.`).join(" "),
    });
    const questions = [...many("Physics", 2), long, ...many("Mathematics", 1)];
    const pages = await pagesOf(await pdfOf(smartBody(questions, "Mathematics, Physics", { theme: "white", questionAreaPct: 40, mcqLayout: "grid" }), "smart-manual-order"));
    assert.match(pages[0], /MATHEMATICS/);
    assert.match(pages[1], /PHYSICS/);
    assert.ok(pages.length >= 5, "four questions plus a blank solving slide for the long one");
    assert.ok(pages.some((p) => p.trim() === ""), "a blank solving slide");
  });
});
