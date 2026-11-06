// Make PDF tests: the exam filter on the question APIs, automatic question
// picking, the institute logo, and the exam paper's style options (font, text
// size, columns, spacing, logo, watermark strength). Routes run against a
// throwaway in-memory MongoDB; real PDFs are printed with the local Chrome
// (those tests are skipped without it). Run with: npx tsx --test tests/make-pdf.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import zlib from "node:zlib";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { EXAMS, examSourcePattern, isExamId, sourceMatchesExam } from "@/lib/examBank";
import { distribute, levelOf, planPick, type ChapterCapacity } from "@/lib/questionPickPlan";
import { questionPaperHtml, type PaperQuestion, type QuestionPaper } from "@/lib/questionPaper/html";
import { parsePaper } from "@/lib/questionPaper/parse";
import { DEFAULT_PAPER_STYLE, normalizePaperStyle, WATERMARK_OPACITY, type PaperStyle } from "@/lib/questionPaper/style";
import { watermarkColor, WATERMARK_COLOR } from "@/lib/questionPaper/watermark";

const JWT_SECRET = "make-pdf-test-jwt-secret-0123456789abcdef";
const BASE = "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);

// ─── Pure rules ────────────────────────────────────────────────────────────

describe("the exams of the question bank", () => {
  test("only JEE and NEET exist; Biology is NEET's and Mathematics JEE's", () => {
    assert.deepEqual(Object.keys(EXAMS), ["JEE", "NEET"]);
    assert.ok(isExamId("JEE") && isExamId("NEET"));
    for (const other of ["MHT_CET_PCM", "HSC_SCIENCE", "Foundation", "General", "All", "", "jee", undefined, null, 5]) assert.equal(isExamId(other), false);
    assert.deepEqual(EXAMS.JEE.subjects, ["Physics", "Chemistry", "Mathematics"]);
    assert.deepEqual(EXAMS.NEET.subjects, ["Physics", "Chemistry", "Biology"]);
  });

  test("a question belongs to an exam by its source, never to both and never by default", () => {
    assert.ok(sourceMatchesExam("JEE MAIN 2020", "JEE"));
    assert.ok(sourceMatchesExam("IIT-JEE 2005", "JEE"));
    assert.ok(sourceMatchesExam("NEET 2019", "NEET"));
    assert.ok(sourceMatchesExam("AIPMT 2014", "NEET"));
    assert.ok(!sourceMatchesExam("NEET 2019", "JEE"));
    assert.ok(!sourceMatchesExam("JEE MAIN 2020", "NEET"));
    assert.ok(!sourceMatchesExam("", "JEE"));
    assert.ok(!sourceMatchesExam(undefined, "NEET"));
    assert.ok(!sourceMatchesExam("MHT CET 2021", "JEE") && !sourceMatchesExam("MHT CET 2021", "NEET"));
    assert.equal(examSourcePattern("JEE"), "(JEE|AIEEE|IIT|BITSAT)");
  });
});

describe("planning an automatic pick", () => {
  const caps = (...rows: [string, number, number, number][]): ChapterCapacity[] =>
    rows.map(([chapter, Easy, Mid, Hard]) => ({ chapter, levels: { Easy, Mid, Hard } }));

  test("distribute shares one at a time and never past a capacity", () => {
    assert.deepEqual(distribute(6, [10, 10, 10]), [2, 2, 2]);
    assert.deepEqual(distribute(7, [10, 10, 10]), [3, 2, 2]);
    assert.deepEqual(distribute(9, [2, 10, 10]), [2, 4, 3]);
    assert.deepEqual(distribute(50, [3, 4]), [3, 4], "can't give more than exists");
    assert.deepEqual(distribute(0, [3, 4]), [0, 0]);
    assert.deepEqual(distribute(5, []), []);
  });

  test("a plain count is spread across the chapters", () => {
    const plan = planPick(caps(["A", 5, 5, 5], ["B", 1, 1, 0]), { kind: "any", count: 10 });
    assert.equal(plan.found, 10);
    assert.deepEqual(plan.takes, [
      { chapter: "A", level: null, count: 8 },
      { chapter: "B", level: null, count: 2 },
    ]);
  });

  test("a mix is drawn level by level, and says what it couldn't find", () => {
    const plan = planPick(caps(["A", 2, 4, 1], ["B", 1, 4, 0]), { kind: "mix", mix: { Easy: 5, Mid: 6, Hard: 3 } });
    assert.deepEqual(plan.foundByLevel, { Easy: 3, Mid: 6, Hard: 1 });
    assert.equal(plan.found, 10);
    assert.equal(plan.requested, 14);
    assert.deepEqual(plan.requestedByLevel, { Easy: 5, Mid: 6, Hard: 3 });
    assert.equal(plan.takes.filter((t) => t.level === "Mid").reduce((n, t) => n + t.count, 0), 6);
  });

  test("a bank spelling 'Medium' counts as Mid; unknown levels count as Mid too", () => {
    assert.equal(levelOf("Medium"), "Mid");
    assert.equal(levelOf("Mid"), "Mid");
    assert.equal(levelOf("Easy"), "Easy");
    assert.equal(levelOf(undefined), "Mid");
  });
});

// instituteLogo reads the database settings when loaded, so it is loaded once they are set (see before()).
let checkLogo: typeof import("@/lib/instituteLogo").checkLogo;
let MAX_LOGO_BYTES: number;

describe("the logo upload checks", () => {
  const png = makePng(32, 24);
  const asBody = (contentType: string, bytes: Buffer | string) => ({ contentType, data: typeof bytes === "string" ? bytes : bytes.toString("base64") });

  test("a real PNG and a real JPEG header pass, with their sizes read from the bytes", () => {
    const ok = checkLogo(asBody("image/png", png));
    assert.deepEqual([ok.contentType, ok.width, ok.height], ["image/png", 32, 24]);
    const jpeg = checkLogo(asBody("image/jpeg", makeJpegHeader(64, 48)));
    assert.deepEqual([jpeg.contentType, jpeg.width, jpeg.height], ["image/jpeg", 64, 48]);
  });

  test("anything else is refused with a plain message", () => {
    const refuse = (body: Record<string, unknown>, message: RegExp) => assert.throws(() => checkLogo(body), message);
    refuse(asBody("image/gif", png), /PNG or JPEG/);
    refuse(asBody("image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), /PNG or JPEG/);
    refuse({ contentType: "image/png" }, /Choose an image/);
    refuse(asBody("image/png", "not base64 !!"), /isn't valid/);
    refuse(asBody("image/png", makeJpegHeader(64, 48)), /isn't a PNG/);
    refuse(asBody("image/jpeg", png), /isn't a JPEG/);
    refuse(asBody("image/png", Buffer.from("<script>alert(1)</script>")), /isn't a PNG/);
    refuse(asBody("image/png", makePng(8, 8)), /too small/);
    refuse(asBody("image/png", makePng(5000, 100)), /too large/);
    refuse(asBody("image/png", Buffer.concat([png, Buffer.alloc(MAX_LOGO_BYTES)])), /too large/);
  });
});

describe("the exam paper's style", () => {
  test("the defaults are the paper as it always was", () => {
    assert.deepEqual(normalizePaperStyle(undefined), DEFAULT_PAPER_STYLE);
    assert.deepEqual(DEFAULT_PAPER_STYLE, { fontFamily: "noto-sans", fontSize: "medium", columns: 2, spacing: "standard", logo: false, watermarkOpacity: 16 });
    assert.equal(watermarkColor(WATERMARK_OPACITY.default), WATERMARK_COLOR, "the default strength is the grey papers have always used");
  });

  test("only listed values are accepted; the rest take their default", () => {
    const bad = normalizePaperStyle({ fontFamily: "../../etc/passwd", fontSize: "huge", columns: 3, spacing: "wide", logo: "yes", watermarkOpacity: "dark" });
    assert.deepEqual(bad, DEFAULT_PAPER_STYLE);
    assert.deepEqual(
      normalizePaperStyle({ fontFamily: "noto-serif", fontSize: "large", columns: 1, spacing: "spacious", logo: true, watermarkOpacity: 30 }),
      { fontFamily: "noto-serif", fontSize: "large", columns: 1, spacing: "spacious", logo: true, watermarkOpacity: 30 }
    );
    assert.equal(normalizePaperStyle({ watermarkOpacity: 99 }).watermarkOpacity, WATERMARK_OPACITY.max);
    assert.equal(normalizePaperStyle({ watermarkOpacity: -4 }).watermarkOpacity, WATERMARK_OPACITY.min);
    assert.equal(normalizePaperStyle({ watermarkOpacity: Number.NaN }).watermarkOpacity, WATERMARK_OPACITY.default);
  });

  test("a stronger watermark prints a darker grey", () => {
    const level = (hex: string) => parseInt(hex.slice(1, 3), 16);
    assert.ok(level(watermarkColor(10)) > level(watermarkColor(16)));
    assert.ok(level(watermarkColor(16)) > level(watermarkColor(40)));
    assert.match(watermarkColor(25), /^#([0-9a-f]{2})\1\1$/);
  });

  test("a request carries the style for an exam paper only", () => {
    const body = (extra: Record<string, unknown>) => ({ marksPerQuestion: 4, questions: [question(1)], ...extra });
    assert.deepEqual(parsePaper(body({})).style, DEFAULT_PAPER_STYLE);
    assert.equal(parsePaper(body({ style: { columns: 1 } })).style?.columns, 1);
    assert.equal(parsePaper(body({ format: "smart", style: { columns: 1 } })).style, undefined);
  });

  test("the page follows the style: font, size, columns, spacing, watermark grey", () => {
    const html = (style: Partial<PaperStyle>, over: Partial<QuestionPaper> = {}) =>
      questionPaperHtml({ ...paper([question(1)]), style: { ...DEFAULT_PAPER_STYLE, ...style }, ...over }, new Map());
    const standard = html({});
    assert.match(standard, /body \{ font-family: "Noto Sans", "Noto Sans Math", sans-serif; font-size: 9\.8pt; line-height: 1\.38;/);
    assert.match(standard, /\.columns \{ column-count: 2; column-gap: 9mm; column-rule: 1px solid #1a1a1a;/);
    assert.match(standard, /\.question \{[^}]*margin: 0 0 3\.2mm;/);
    assert.ok(!standard.includes('font-family: "Noto Serif"'));

    const custom = html({ fontFamily: "noto-serif", fontSize: "large", columns: 1, spacing: "spacious", watermarkOpacity: 30 }, { watermark: "Sunrise" });
    assert.ok(custom.includes('font-family: "Noto Serif"'));
    assert.match(custom, /body \{ font-family: "Noto Serif", "Noto Sans Math", serif; font-size: 10\.8pt; line-height: 1\.5;/);
    assert.match(custom, /column-count: 1; column-gap: 9mm; column-rule: none;/);
    assert.match(custom, /\.question \{[^}]*margin: 0 0 5mm;/);
    assert.ok(custom.includes(`color: ${watermarkColor(30)}`));
    assert.ok(html({}, { watermark: "Sunrise" }).includes(`color: ${WATERMARK_COLOR}`));
    assert.ok(!standard.includes("class=\"watermark\""), "no watermark unless one is given");
  });

  test("the logo prints only when the style asks and the account has one", () => {
    const logo = "data:image/png;base64,AAAA";
    const asked = questionPaperHtml({ ...paper([question(1)]), style: { ...DEFAULT_PAPER_STYLE, logo: true }, logo }, new Map());
    assert.ok(asked.includes(`<img class="logo" src="${logo}"`));
    assert.ok(asked.includes("has-logo"));
    assert.ok(!questionPaperHtml({ ...paper([question(1)]), style: DEFAULT_PAPER_STYLE, logo }, new Map()).includes('class="logo"'), "not asked for");
    assert.ok(!questionPaperHtml({ ...paper([question(1)]), style: { ...DEFAULT_PAPER_STYLE, logo: true } }, new Map()).includes('class="logo"'), "none uploaded");
  });
});

// ─── The routes ────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;
const tokens: Record<string, string> = {};
const ids: Record<string, string[]> = {};

async function load() {
  const [questions, filters, pick, logo, pdf, render, auth, db] = await Promise.all([
    import("@/app/api/questions/route"),
    import("@/app/api/filters/route"),
    import("@/app/api/questions/pick/route"),
    import("@/app/api/tuition/logo/route"),
    import("@/app/api/question-paper-pdf/route"),
    import("@/lib/questionPaper/render"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    questions,
    filters,
    pick,
    logo,
    pdf,
    render,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Question: (await import("@/models/Question")).default,
    InstituteLogo: (await import("@/models/InstituteLogo")).default,
  };
}

async function seed() {
  const mongoose = (await import("mongoose")).default;
  const { Tuition, User, auth, Question } = m;
  const [a, b] = await Tuition.create([{ name: "Alpha classes" }, { name: "Beta classes" }]);
  const user = (email: string, role: string, tuitionId: unknown) => User.create({ email, name: email, passwordHash: "x", role, tuitionId, emailVerified: true });
  const users = {
    teacherA: await user("ta@test.local", "teacher", a._id),
    ownerA: await user("oa@test.local", "tuition", a._id),
    studentA: await user("sa@test.local", "student", a._id),
    teacherB: await user("tb@test.local", "teacher", b._id),
    ownerB: await user("ob@test.local", "tuition", b._id),
  };
  for (const [name, u] of Object.entries(users)) tokens[name] = await auth.signToken(u);

  const paperId = new mongoose.Types.ObjectId();
  let n = 0;
  const add = async (key: string, count: number, over: Record<string, unknown>) => {
    const docs = Array.from({ length: count }, (_, i) => ({
      paperId,
      questionNumber: ++n,
      examCategory: "JEE/NEET",
      standard: "11th",
      subject: "Physics",
      chapter: "Kinematics",
      topic: "",
      section: "A",
      questionText: `${key} question ${i + 1}`,
      optionA: "a",
      optionB: "b",
      optionC: "c",
      optionD: "d",
      correctAnswer: "B",
      answerType: "MCQ",
      difficulty: "Medium",
      explanation: `${key} solution`,
      source: "",
      ...over,
      ...(typeof over.difficulty === "function" ? { difficulty: (over.difficulty as (i: number) => string)(i) } : {}),
    }));
    const created = await Question.insertMany(docs);
    ids[key] = created.map((doc: { _id: unknown }) => String(doc._id));
  };
  const levels = (i: number) => ["Easy", "Easy", "Medium", "Medium", "Hard", "Hard"][i % 6];
  await add("jeeKinematics", 6, { source: "JEE MAIN 2020", difficulty: levels });
  await add("jeeNumerical", 2, { source: "JEE MAIN 2020", answerType: "Numerical", correctAnswer: "12" });
  await add("jeeOptics", 4, { source: "IIT JEE 2005", chapter: "Optics" });
  await add("jeeMaths", 3, { source: "JEE MAIN 2021", subject: "Mathematics", chapter: "Algebra" });
  await add("neetKinematics", 5, { source: "NEET 2019", difficulty: "Easy" });
  await add("neetBiology", 3, { source: "AIPMT 2014", subject: "Biology", chapter: "Cell" });
  await add("unsourced", 2, { source: "" });
  await add("otherExam", 2, { source: "MHT CET 2021" });
  await add("descriptive", 1, { source: "JEE MAIN 2020", answerType: "Descriptive" });
  await add("bankCopy", 1, { source: "JEE MAIN 2020", bankCopy: true });
  await add("foundation", 2, { source: "JEE MAIN 2020", examCategory: "Foundation", standard: "9th", subject: "Science" });
}

function request(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000" };
  if (who) headers.authorization = `Bearer ${tokens[who] ?? who}`;
  return new NextRequest(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const get = (handler: (req: NextRequest, ctx: unknown) => Promise<Response>, path: string, who: string | null = null) => handler(request("GET", path, who), {});
const send = (handler: (req: NextRequest, ctx: unknown) => Promise<Response>, method: string, path: string, who: string | null, body?: unknown) =>
  handler(request(method, path, who, body), {});

const put = (who: string | null, body: unknown) => send(m.logo.PUT, "PUT", "/api/tuition/logo", who, body);

async function json(res: Response, status = 200) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}`);
  return res.json();
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "make_pdf_test";
  process.env.JWT_SECRET = JWT_SECRET;
  m = await load();
  ({ checkLogo, MAX_LOGO_BYTES } = await import("@/lib/instituteLogo"));
  await m.db.connectDB();
  await seed();
});

after(async () => {
  await m?.render.setBrowserLauncherForTests(null);
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

const idsOf = (docs: { _id: string }[]) => docs.map((d) => String(d._id)).sort();
const sortedIds = (...keys: string[]) => keys.flatMap((k) => ids[k]).sort();

describe("?exam= on the question APIs", () => {
  test("without it nothing changes: every bank question except descriptive ones and paper copies", async () => {
    const body = await json(await get(m.questions.GET, "/api/questions?limit=500"));
    const all = sortedIds("jeeKinematics", "jeeNumerical", "jeeOptics", "jeeMaths", "neetKinematics", "neetBiology", "unsourced", "otherExam", "foundation");
    assert.deepEqual(idsOf(body.questions), all);
  });

  test("JEE Physics is JEE's questions only: not NEET's, not unsourced, not another exam's, not Foundation", async () => {
    const body = await json(await get(m.questions.GET, "/api/questions?exam=JEE&subject=Physics&limit=500"));
    assert.deepEqual(idsOf(body.questions), sortedIds("jeeKinematics", "jeeNumerical", "jeeOptics"));
    assert.equal(body.total, 12);
  });

  test("NEET Physics and NEET Biology", async () => {
    const physics = await json(await get(m.questions.GET, "/api/questions?exam=NEET&subject=Physics"));
    assert.deepEqual(idsOf(physics.questions), sortedIds("neetKinematics"));
    const biology = await json(await get(m.questions.GET, "/api/questions?exam=NEET&subject=Biology"));
    assert.deepEqual(idsOf(biology.questions), sortedIds("neetBiology"));
  });

  test("the exam combines with chapter, level, search and year", async () => {
    const chapter = await json(await get(m.questions.GET, "/api/questions?exam=JEE&subject=Physics&chapter=Optics"));
    assert.deepEqual(idsOf(chapter.questions), sortedIds("jeeOptics"));
    const hard = await json(await get(m.questions.GET, "/api/questions?exam=JEE&subject=Physics&chapter=Kinematics&level=Hard&answerType=MCQ"));
    assert.equal(hard.total, 2);
    const year = await json(await get(m.questions.GET, "/api/questions?exam=JEE&subject=Physics&year=2005"));
    assert.deepEqual(idsOf(year.questions), sortedIds("jeeOptics"));
    const noYear = await json(await get(m.questions.GET, "/api/questions?exam=NEET&year=2005"));
    assert.equal(noYear.total, 0, "the exam and the year both apply");
    const page = await json(await get(m.questions.GET, "/api/questions?exam=JEE&subject=Physics&limit=5&page=2"));
    assert.equal(page.count, 5);
    assert.equal(page.total, 12);
  });

  test("a subject the exam hasn't, an unknown exam, or another category is refused", async () => {
    for (const path of [
      "/api/questions?exam=JEE&subject=Biology",
      "/api/questions?exam=NEET&subject=Mathematics",
      "/api/questions?exam=MHT_CET_PCM",
      "/api/questions?exam=jee",
      "/api/questions?exam=JEE&examCategory=Foundation",
    ]) {
      const body = await json(await get(m.questions.GET, path), 400);
      assert.equal(typeof body.error, "string", path);
    }
  });

  test("filters list only the exam's chapters, with their counts", async () => {
    const jee = await json(await get(m.filters.GET, "/api/filters?exam=JEE&subject=Physics"));
    assert.deepEqual(jee.chapters, ["Kinematics", "Optics"]);
    assert.deepEqual(jee.chapterCounts, { Kinematics: 8, Optics: 4 });
    const neet = await json(await get(m.filters.GET, "/api/filters?exam=NEET&subject=Physics"));
    assert.deepEqual(neet.chapterCounts, { Kinematics: 5 });
    const plain = await json(await get(m.filters.GET, "/api/filters?examCategory=JEE/NEET&subject=Physics"));
    assert.ok(plain.chapterCounts.Kinematics > 8, "without an exam, nothing changes");
    await json(await get(m.filters.GET, "/api/filters?exam=JEE&subject=Biology"), 400);
  });
});

describe("POST /api/questions/pick", () => {
  const pick = (who: string | null, body: unknown) => send(m.pick.POST, "POST", "/api/questions/pick", who, body);
  const base = { exam: "JEE", subject: "Physics", chapters: ["Kinematics"], count: 5 };

  test("only a teacher or the tuition's account may pick", async () => {
    await json(await pick(null, base), 401);
    await json(await pick("studentA", base), 403);
    assert.equal((await pick("teacherA", base)).status, 200);
    assert.equal((await pick("ownerA", base)).status, 200);
  });

  test("bad requests are refused in plain words", async () => {
    const refuse = async (over: Record<string, unknown>, message: RegExp) => assert.match((await json(await pick("teacherA", { ...base, ...over }), 400)).error, message);
    await refuse({ exam: "CET" }, /Choose an exam/);
    await refuse({ exam: undefined }, /Choose an exam/);
    await refuse({ subject: "Biology" }, /isn't part of JEE/);
    await refuse({ subject: undefined }, /Choose a subject/);
    await refuse({ count: 0 }, /whole number from 1 to 300/);
    await refuse({ count: 301 }, /whole number from 1 to 300/);
    await refuse({ count: 2.5 }, /whole number/);
    await refuse({ count: undefined }, /whole number/);
    await refuse({ mix: { Easy: 0, Mid: 0, Hard: 0 } }, /1 to 300/);
    await refuse({ mix: { Easy: -1, Mid: 2 } }, /whole number/);
    await refuse({ answerType: "Descriptive" }, /MCQ, Numerical or any/);
    await refuse({ chapters: "Kinematics" }, /must be a list/);
    await refuse({ chapters: [""] }, /list of names/);
    await refuse({ exclude: ["not-an-id"] }, /list of up to 1000 question ids/);
    await refuse({ exclude: Array.from({ length: 1001 }, () => "a".repeat(24)) }, /up to 1000/);
  });

  test("picks real questions of that exam, subject and chapter, MCQs before numerical ones", async () => {
    const body = await json(await pick("teacherA", { ...base, count: 7 }));
    assert.equal(body.found, 7);
    assert.equal(body.complete, true);
    const pool = new Set(sortedIds("jeeKinematics", "jeeNumerical"));
    for (const q of body.questions) {
      assert.ok(pool.has(String(q._id)), "a Kinematics question asked in JEE");
      assert.equal(q.chapter, "Kinematics");
      assert.match(q.source, /JEE/);
    }
    assert.equal(new Set(body.questions.map((q: { _id: string }) => q._id)).size, 7, "no question twice");
    const kinds = body.questions.map((q: { answerType: string }) => q.answerType);
    assert.deepEqual(kinds, [...kinds].sort((x: string, y: string) => (x === "Numerical" ? 1 : 0) - (y === "Numerical" ? 1 : 0)));
  });

  test("a mix is honoured level by level", async () => {
    const body = await json(await pick("teacherA", { ...base, answerType: "MCQ", count: undefined, mix: { Easy: 2, Mid: 1, Hard: 2 } }));
    assert.equal(body.found, 5);
    const count = (level: string) => body.questions.filter((q: { difficulty: string }) => levelOf(q.difficulty) === level).length;
    assert.deepEqual([count("Easy"), count("Mid"), count("Hard")], [2, 1, 2]);
    assert.deepEqual(body.foundByLevel, { Easy: 2, Mid: 1, Hard: 2 });
  });

  test("when there aren't enough, it says so and returns only what exists, never from elsewhere", async () => {
    const body = await json(await pick("teacherA", { ...base, count: 20 }));
    assert.equal(body.requested, 20);
    assert.equal(body.found, 8);
    assert.equal(body.complete, false);
    assert.equal(body.available.total, 8);
    const allowed = new Set(sortedIds("jeeKinematics", "jeeNumerical"));
    assert.ok(body.questions.every((q: { _id: string }) => allowed.has(String(q._id))));

    const hard = await json(await pick("teacherA", { ...base, answerType: "MCQ", count: undefined, mix: { Easy: 0, Mid: 0, Hard: 5 } }));
    assert.equal(hard.found, 2);
    assert.equal(hard.complete, false);
    assert.equal(hard.available.Hard, 2);
    assert.deepEqual(hard.requestedByLevel, { Easy: 0, Mid: 0, Hard: 5 });
  });

  test("each chosen chapter gets its share", async () => {
    const body = await json(await pick("teacherA", { ...base, chapters: ["Kinematics", "Optics"], answerType: "MCQ", count: 6 }));
    const by = (chapter: string) => body.questions.filter((q: { chapter: string }) => q.chapter === chapter).length;
    assert.deepEqual([by("Kinematics"), by("Optics")], [3, 3]);
  });

  test("no chapters means every chapter of the subject; Biology and Mathematics follow their exam", async () => {
    const all = await json(await pick("teacherA", { ...base, chapters: [], count: 300 }));
    assert.equal(all.found, 12);
    const biology = await json(await pick("teacherA", { exam: "NEET", subject: "Biology", chapters: [], count: 10 }));
    assert.deepEqual(idsOf(biology.questions), sortedIds("neetBiology"));
    const maths = await json(await pick("teacherA", { exam: "JEE", subject: "Mathematics", chapters: [], count: 10 }));
    assert.deepEqual(idsOf(maths.questions), sortedIds("jeeMaths"));
  });

  test("the type filter and the left-out ids apply", async () => {
    const numerical = await json(await pick("teacherA", { ...base, answerType: "Numerical", count: 5 }));
    assert.deepEqual(idsOf(numerical.questions), sortedIds("jeeNumerical"));
    assert.equal(numerical.complete, false);

    const used = ids.jeeKinematics.slice(0, 4);
    const fresh = await json(await pick("teacherA", { ...base, answerType: "MCQ", count: 6, exclude: used }));
    assert.equal(fresh.found, 2);
    assert.equal(fresh.avoided, 4);
    assert.ok(fresh.questions.every((q: { _id: string }) => !used.includes(String(q._id))));
    assert.equal(fresh.available.total, 2);
    // Ids from elsewhere in the bank change nothing.
    const other = await json(await pick("teacherA", { ...base, answerType: "MCQ", count: 6, exclude: ids.neetKinematics }));
    assert.equal(other.found, 6);
    assert.equal(other.avoided, 0);
  });

  test("descriptive questions, paper copies, other exams and Foundation are never picked", async () => {
    const forbidden = new Set(sortedIds("descriptive", "bankCopy", "foundation", "unsourced", "otherExam", "neetKinematics"));
    const body = await json(await pick("teacherA", { ...base, chapters: [], count: 300 }));
    assert.ok(body.questions.every((q: { _id: string }) => !forbidden.has(String(q._id))));
  });

  test("picking changes nothing in the bank", async () => {
    const before = await m.Question.countDocuments({});
    await pick("teacherA", { ...base, count: 5 });
    assert.equal(await m.Question.countDocuments({}), before);
    const doc = await m.Question.findById(ids.jeeKinematics[0]).lean<{ explanation: string }>();
    assert.equal(doc?.explanation, "jeeKinematics solution");
  });
});

describe("the institute logo routes", () => {
  const png = makePng(40, 40);
  const upload = { contentType: "image/png", data: png.toString("base64") };

  test("only the tuition's own account sets or removes the logo; its teachers may read it", async () => {
    await json(await put(null, upload), 401);
    await json(await put("teacherA", upload), 403);
    await json(await put("studentA", upload), 403);
    await json(await get(m.logo.GET, "/api/tuition/logo", "studentA"), 403);
    await json(await send(m.logo.DELETE, "DELETE", "/api/tuition/logo", "teacherA"), 403);
    assert.equal((await json(await get(m.logo.GET, "/api/tuition/logo", "teacherA"))).logo, null);

    const saved = await json(await put("ownerA", upload));
    assert.equal(saved.logo.contentType, "image/png");
    assert.equal(saved.logo.width, 40);
    assert.equal(saved.logo.dataUri, `data:image/png;base64,${upload.data}`);
    const seen = await json(await get(m.logo.GET, "/api/tuition/logo", "teacherA"));
    assert.equal(seen.logo.dataUri, saved.logo.dataUri);
  });

  test("each institute has its own: another's logo is never seen or removed", async () => {
    assert.equal((await json(await get(m.logo.GET, "/api/tuition/logo", "teacherB"))).logo, null);
    assert.equal((await json(await get(m.logo.GET, "/api/tuition/logo", "ownerB"))).logo, null);
    await json(await send(m.logo.DELETE, "DELETE", "/api/tuition/logo", "ownerB"), 404);
    assert.ok((await json(await get(m.logo.GET, "/api/tuition/logo", "teacherA"))).logo, "A's logo is still there");
    assert.equal(await m.InstituteLogo.countDocuments({}), 1);
  });

  test("bad uploads are refused and leave the saved logo alone", async () => {
    const before = (await json(await get(m.logo.GET, "/api/tuition/logo", "ownerA"))).logo.dataUri;
    for (const body of [
      { contentType: "image/gif", data: upload.data },
      { contentType: "image/png", data: Buffer.from("<svg onload=alert(1)>").toString("base64") },
      { contentType: "image/png", data: "####" },
      { contentType: "image/jpeg", data: upload.data },
      { contentType: "image/png", data: Buffer.concat([png, Buffer.alloc(MAX_LOGO_BYTES + 10)]).toString("base64") },
      {},
    ]) {
      assert.equal((await put("ownerA", body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await put("ownerA", "[]" as unknown)).status, 400);
    assert.equal((await json(await get(m.logo.GET, "/api/tuition/logo", "ownerA"))).logo.dataUri, before);
  });

  test("the logo can be replaced and removed", async () => {
    const next = makePng(64, 32);
    const replaced = await json(await put("ownerA", { contentType: "image/png", data: next.toString("base64") }));
    assert.equal(replaced.logo.width, 64);
    assert.equal(await m.InstituteLogo.countDocuments({}), 1, "replaced, not added");
    await json(await send(m.logo.DELETE, "DELETE", "/api/tuition/logo", "ownerA"));
    assert.equal((await json(await get(m.logo.GET, "/api/tuition/logo", "teacherA"))).logo, null);
  });
});

describe("making an exam PDF with the logo", () => {
  const paperBody = (style: Record<string, unknown>) => ({
    title: "Kinematics",
    standard: "11th",
    subject: "Physics",
    marksPerQuestion: 4,
    answerKey: true,
    style,
    questions: Array.from({ length: 6 }, (_, i) => ({ ...question(i + 1), diagramUrls: [], optionDiagramUrls: { A: [], B: [], C: [], D: [] }, explanationDiagramUrls: [] })),
  });
  const make = (who: string, style: Record<string, unknown>) => send(m.pdf.POST, "POST", "/api/question-paper-pdf", who, paperBody(style));

  test("asking for a logo the institute hasn't uploaded is refused clearly, before anything prints", async () => {
    assert.equal((await m.InstituteLogo.countDocuments({})), 0);
    const body = await json(await make("teacherA", { logo: true }), 400);
    assert.match(body.error, /no logo yet/);
  });

  test("a teacher gets their own institute's logo, never another's", { skip: !haveChrome && "Chrome isn't installed", timeout: 90000 }, async () => {
    await json(await put("ownerA", { contentType: "image/png", data: makePng(60, 60).toString("base64") }));
    const withLogo = await make("teacherA", { logo: true, fontFamily: "noto-serif", columns: 1, spacing: "spacious", fontSize: "large", watermarkOpacity: 30 });
    assert.equal(withLogo.status, 200);
    assert.equal(withLogo.headers.get("content-type"), "application/pdf");
    assert.equal(withLogo.headers.get("x-layout-errors"), "0");
    const bytes = new Uint8Array(await withLogo.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.subarray(0, 5)), "%PDF-");
    assert.ok((await imagesOnFirstPage(bytes)) >= 1, "the logo is painted on the first page");

    // Teacher B's institute has no logo: A's is not lent to them.
    await json(await make("teacherB", { logo: true }), 400);
    // Without asking, no logo is printed even though the institute has one.
    const plain = await make("teacherA", {});
    assert.equal(plain.status, 200);
    assert.equal(await imagesOnFirstPage(new Uint8Array(await plain.arrayBuffer())), 0);
  });

  test("unknown style values never reach the page: they fall back to the defaults", { skip: !haveChrome && "Chrome isn't installed", timeout: 90000 }, async () => {
    const res = await make("teacherA", { fontFamily: "Comic Sans", columns: 9, fontSize: "x", spacing: "y", logo: "yes", watermarkOpacity: "dark" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-layout-errors"), "0");
  });
});

describe("exam papers in every style, printed and checked", { skip: !haveChrome && "Chrome isn't installed" }, () => {
  const styles: [string, Partial<PaperStyle>][] = [
    ["default", {}],
    ["serif, one column, spacious, large", { fontFamily: "noto-serif", columns: 1, spacing: "spacious", fontSize: "large" }],
    ["sans, one column, compact, small", { columns: 1, spacing: "compact", fontSize: "small" }],
    ["serif, two columns, compact", { fontFamily: "noto-serif", spacing: "compact" }],
  ];
  for (const [name, style] of styles) {
    test(`${name}: no layout errors, answer key and solutions included`, { timeout: 90000 }, async () => {
      const { renderPaper } = m.render;
      const questions = Array.from({ length: 24 }, (_, i) =>
        question(i + 1, { questionText: `Q${i + 1}. A particle moves with \\(v = ${i + 2}t^2 + \\frac{1}{2}at\\). Find the displacement after \\(t = 3\\) s if the acceleration is \\(a = 4\\ \\text{m/s}^2\\).` })
      );
      const html = questionPaperHtml(
        { ...paper(questions), questionPaper: true, answerKey: true, solutions: true, watermark: "Sunrise Classes", style: { ...DEFAULT_PAPER_STYLE, ...style, watermarkOpacity: 25 } },
        new Map()
      );
      const { pdf, layout } = await renderPaper(html, questions.length, 80000, "Sunrise Classes");
      assert.equal(String.fromCharCode(...pdf.subarray(0, 5)), "%PDF-");
      assert.deepEqual(layout.issues.filter((i) => i.severity === "error"), []);
      assert.ok(layout.stats.pages >= 3, `${layout.stats.pages} pages`);
    });
  }

  test("one column takes at least as many pages as two", { timeout: 90000 }, async () => {
    const questions = Array.from({ length: 30 }, (_, i) => question(i + 1));
    const pages = async (columns: 1 | 2) =>
      (await m.render.renderPaper(questionPaperHtml({ ...paper(questions), style: { ...DEFAULT_PAPER_STYLE, columns } }, new Map()), 30, 80000)).layout.stats.pages;
    assert.ok((await pages(1)) >= (await pages(2)));
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function question(n: number, over: Partial<PaperQuestion> = {}): PaperQuestion {
  return {
    questionText: `Question ${n}: a body of mass ${n} kg moves with uniform velocity. What is its momentum if the speed is 3 m/s?`,
    optionA: "3 kg m/s",
    optionB: "6 kg m/s",
    optionC: "9 kg m/s",
    optionD: "12 kg m/s",
    answerType: "MCQ",
    correctAnswer: "A",
    explanation: "Momentum is mass times velocity.",
    chapter: "Laws of motion",
    source: "JEE MAIN 2020",
    diagramUrls: [],
    optionDiagramUrls: { A: [], B: [], C: [], D: [] },
    explanationDiagramUrls: [],
    ...over,
  };
}

function paper(questions: PaperQuestion[]): QuestionPaper {
  return {
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
  };
}

/** A solid-colour w × h PNG (a real, decodable image). */
function makePng(width: number, height: number): Buffer {
  const crc = (buf: Buffer) => zlib.crc32(buf) >>> 0;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  // Rows of "filter 0" then the pixels; tiny images only (5000 × 100 is built from a short row of zeros).
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: Math.min(height, 2000) }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Just enough JPEG for its size to be read: SOI, a frame header, EOI. */
function makeJpegHeader(width: number, height: number): Buffer {
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(17, 0);
  frame[2] = 8;
  frame.writeUInt16BE(height, 3);
  frame.writeUInt16BE(width, 5);
  frame[7] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), frame, Buffer.from([0xff, 0xd9])]);
}

/** Images painted on a PDF's first page. */
async function imagesOnFirstPage(bytes: Uint8Array): Promise<number> {
  const { loadPdfjs } = await import("@/lib/pdfjsNode");
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const { fnArray } = await page.getOperatorList();
  const count = fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject).length;
  await task.destroy();
  return count;
}
