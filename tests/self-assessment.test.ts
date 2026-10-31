// Self-assessment: the question picker and the topic report on their own, then
// the routes end to end against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import {
  buildReport,
  MIX_SPLIT,
  pickQuestions,
  seededRandom,
  shareOut,
  SMART_SPLIT,
  splitFor,
  type Difficulty,
  type PoolQuestion,
} from "@/lib/assessment-pick";

// ─── The picker ────────────────────────────────────────────────────────────

function makePool(spec: Record<string, Partial<Record<Difficulty, number>>>, tier: (i: number) => 0 | 1 | 2 = () => 0): PoolQuestion[] {
  const pool: PoolQuestion[] = [];
  let i = 0;
  for (const [unit, levels] of Object.entries(spec)) {
    for (const [difficulty, n] of Object.entries(levels) as [Difficulty, number][]) {
      for (let k = 0; k < n; k++, i++) pool.push({ id: `q${i}`, unit, difficulty, tier: tier(i) });
    }
  }
  return pool;
}
const units = (...keys: string[]) => keys.map((key) => ({ key, level: "not-enough" as const }));
const count = (qs: PoolQuestion[], f: (q: PoolQuestion) => boolean) => qs.filter(f).length;

describe("shareOut", () => {
  test("shares evenly, gives the rest to the first, and respects caps", () => {
    const even = shareOut(10, [
      { key: "a", weight: 1, cap: 99 },
      { key: "b", weight: 1, cap: 99 },
      { key: "c", weight: 1, cap: 99 },
    ]);
    assert.deepEqual([...even.values()], [4, 3, 3]);
    const capped = shareOut(10, [
      { key: "a", weight: 1, cap: 2 },
      { key: "b", weight: 1, cap: 99 },
    ]);
    assert.deepEqual([...capped.values()], [2, 8], "a capped topic's leftover goes to the others");
    const short = shareOut(10, [{ key: "a", weight: 1, cap: 4 }]);
    assert.equal(short.get("a"), 4, "never more than there is");
  });

  test("weights the shares", () => {
    const s = shareOut(20, [
      { key: "e", weight: 0.3, cap: 99 },
      { key: "m", weight: 0.5, cap: 99 },
      { key: "h", weight: 0.2, cap: 99 },
    ]);
    assert.deepEqual([...s.values()], [6, 10, 4]);
  });
});

describe("splitFor", () => {
  test("fixed mixes ignore history; Smart follows accuracy once there's enough", () => {
    assert.deepEqual(splitFor("balanced", { answered: 50, correct: 5 }).split, MIX_SPLIT.balanced);
    assert.deepEqual(splitFor("challenge", { answered: 0, correct: 0 }).split, MIX_SPLIT.challenge);
    assert.equal(splitFor("smart", { answered: 2, correct: 0 }).basis.kind, "no-history");
    assert.deepEqual(splitFor("smart", { answered: 10, correct: 2 }).split, SMART_SPLIT.struggling);
    assert.deepEqual(splitFor("smart", { answered: 10, correct: 5 }).split, SMART_SPLIT.steady);
    const confident = splitFor("smart", { answered: 10, correct: 9 });
    assert.deepEqual(confident.split, SMART_SPLIT.confident);
    assert.equal(confident.basis.accuracy, 90);
  });
});

describe("pickQuestions", () => {
  const plenty = { Easy: 30, Medium: 30, Hard: 30 };

  test("a balanced test of 20 over two topics: 6 easy, 10 medium, 4 hard, 10 per topic, no repeats", () => {
    const { questions, plan } = pickQuestions({ pool: makePool({ a: plenty, b: plenty }), units: units("a", "b"), count: 20, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(1) });
    assert.equal(questions.length, 20);
    assert.equal(new Set(questions.map((q) => q.id)).size, 20);
    assert.deepEqual(plan.byDifficulty, { Easy: 6, Medium: 10, Hard: 4 });
    assert.equal(count(questions, (q) => q.unit === "a"), 10);
    assert.equal(count(questions, (q) => q.unit === "b"), 10);
  });

  test("a retake of 30 is 9 easy, 9 medium, 12 hard (30/30/40)", () => {
    assert.deepEqual(splitFor("retake", { answered: 40, correct: 8 }).split, MIX_SPLIT.retake);
    const { questions, plan } = pickQuestions({ pool: makePool({ a: plenty, b: plenty, c: plenty }), units: units("a", "b", "c"), count: 30, split: MIX_SPLIT.retake, smart: false, random: seededRandom(4) });
    assert.equal(questions.length, 30);
    assert.deepEqual(plan.byDifficulty, { Easy: 9, Medium: 9, Hard: 12 });
  });

  test("runs easy → medium → hard, with topics taking turns", () => {
    const { questions } = pickQuestions({ pool: makePool({ a: plenty, b: plenty }), units: units("a", "b"), count: 12, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(2) });
    const rank = { Easy: 0, Medium: 1, Hard: 2 };
    for (let i = 1; i < questions.length; i++) assert.ok(rank[questions[i - 1].difficulty] <= rank[questions[i].difficulty], "never harder then easier");
    const mediums = questions.filter((q) => q.difficulty === "Medium");
    assert.notEqual(mediums[0].unit, mediums[1].unit, "topics alternate within a band");
  });

  test("when hard questions run short, the nearest level fills in and the size holds", () => {
    const { questions, plan } = pickQuestions({ pool: makePool({ a: { Easy: 20, Medium: 20, Hard: 1 } }), units: units("a"), count: 20, split: MIX_SPLIT.challenge, smart: false, random: seededRandom(3) });
    assert.equal(questions.length, 20);
    assert.equal(plan.byDifficulty.Hard, 1, "the only hard one");
    assert.ok(plan.byDifficulty.Medium > plan.byDifficulty.Easy, "medium (nearest to hard) takes most of the shortfall");
  });

  test("a topic with few questions gives what it has; the others make up the rest", () => {
    const { plan } = pickQuestions({ pool: makePool({ a: { Medium: 2 }, b: plenty }), units: units("a", "b"), count: 10, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(4) });
    assert.deepEqual(plan.byUnit, [
      { key: "a", count: 2 },
      { key: "b", count: 8 },
    ]);
  });

  test("fewer questions than asked when the bank hasn't enough", () => {
    const { questions, plan } = pickQuestions({ pool: makePool({ a: { Easy: 3 } }), units: units("a"), count: 10, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(5) });
    assert.equal(questions.length, 3);
    assert.equal(plan.requested, 10);
    assert.equal(plan.available.total, 3);
  });

  test("questions never answered come first, then ones answered wrongly", () => {
    // 10 medium: 3 new, 3 wrong before, 4 right before.
    const pool = makePool({ a: { Medium: 10 } }, (i) => (i < 3 ? 0 : i < 6 ? 1 : 2));
    const { questions, plan } = pickQuestions({ pool, units: units("a"), count: 5, split: { Easy: 0, Medium: 1, Hard: 0 }, smart: false, random: seededRandom(6) });
    assert.equal(count(questions, (q) => q.tier === 0), 3);
    assert.equal(count(questions, (q) => q.tier === 1), 2);
    assert.equal(plan.fresh, 3);
  });

  test("more topics than questions: every chapter gets a share, not just the first ones", () => {
    // 6 chapters × 10 topics, 12 questions: 2 per chapter, whatever order they come in.
    const spec: Record<string, { Medium: number }> = {};
    const list = [];
    for (let c = 0; c < 6; c++) for (let t = 0; t < 10; t++) {
      spec[`c${c}t${t}`] = { Medium: 5 };
      list.push({ key: `c${c}t${t}`, level: "not-enough" as const, group: `c${c}` });
    }
    for (const seed of [1, 2, 3]) {
      const { plan } = pickQuestions({ pool: makePool(spec), units: list, count: 12, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(seed) });
      for (let c = 0; c < 6; c++) assert.equal(plan.byUnit.filter((u) => u.key.startsWith(`c${c}t`)).reduce((n, u) => n + u.count, 0), 2, `chapter ${c}, seed ${seed}`);
    }
    const a = pickQuestions({ pool: makePool(spec), units: list, count: 12, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(1) }).plan.byUnit;
    const b = pickQuestions({ pool: makePool(spec), units: list, count: 12, split: MIX_SPLIT.balanced, smart: false, random: seededRandom(9) }).plan.byUnit;
    assert.notDeepEqual(a, b, "which topics get them varies");
  });

  test("Smart gives weak topics a bigger share", () => {
    const { plan } = pickQuestions({
      pool: makePool({ weak: plenty, strong: plenty }),
      units: [
        { key: "weak", level: "weak" },
        { key: "strong", level: "strong" },
      ],
      count: 20,
      split: SMART_SPLIT.steady,
      smart: true,
      random: seededRandom(7),
    });
    const [weak, strong] = plan.byUnit.map((u) => u.count);
    assert.ok(weak > strong * 2, `weak ${weak} vs strong ${strong}`);
  });
});

describe("buildReport", () => {
  const q = (topic: string, difficulty: string) => ({ standard: "11th", chapter: "Kinematics", topic, difficulty });
  // Projectile: 1 right, 2 wrong, 1 skipped. Relative: 3 right.
  const questions = [q("Projectile", "Easy"), q("Projectile", "Medium"), q("Projectile", "Hard"), q("Projectile", "Hard"), q("Relative", "Easy"), q("Relative", "Medium"), q("Relative", "Medium")];
  const answers = [
    { index: 0, selected: "A", correct: true },
    { index: 1, selected: "B", correct: false },
    { index: 2, selected: "C", correct: false },
    { index: 3, selected: null, correct: null },
    { index: 4, selected: "A", correct: true },
    { index: 5, selected: "A", correct: true },
    { index: 6, selected: "D", correct: true },
  ];
  const report = buildReport(questions, answers);

  test("each topic's strength and weakness, weakest first", () => {
    const [proj, rel] = report.topics;
    assert.equal(proj.topic, "Projectile");
    assert.deepEqual([proj.total, proj.correct, proj.wrong, proj.skipped], [4, 1, 2, 1]);
    assert.equal(proj.strength, 25, "1 of 4 asked");
    assert.equal(proj.weakness, 75);
    assert.equal(proj.accuracy, 33, "1 of 3 answered");
    assert.equal(proj.level, "weak");
    assert.deepEqual(proj.wrongNumbers, [2, 3]);
    assert.deepEqual(proj.skippedNumbers, [4]);
    assert.equal(proj.shareOfMistakes, 100, "every lost question is in Projectile");
    assert.equal(rel.strength, 100);
    assert.equal(rel.level, "strong");
    assert.equal(report.weakTopics, 1);
    assert.equal(report.strongTopics, 1);
  });

  test("overall, by chapter and by difficulty, with a headline and advice", () => {
    assert.deepEqual([report.overall.correct, report.overall.wrong, report.overall.skipped], [4, 2, 1]);
    assert.equal(report.chapters.length, 1);
    assert.equal(report.chapters[0].topics, 2);
    const hard = report.difficulty.find((d) => d.difficulty === "Hard")!;
    assert.deepEqual([hard.total, hard.correct], [2, 0]);
    assert.match(report.headline, /Projectile/);
    assert.match(report.advice[0], /Revise Projectile/);
  });
});

// ─── The routes ────────────────────────────────────────────────────────────

const BASE = "http://localhost:3000";
let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [listRoute, planRoute, oneRoute, startRoute, answersRoute, submitRoute, topicsRoute, auth, db] = await Promise.all([
    import("@/app/api/self-assessments/route"),
    import("@/app/api/self-assessments/plan/route"),
    import("@/app/api/self-assessments/[id]/route"),
    import("@/app/api/self-assessments/[id]/start/route"),
    import("@/app/api/self-assessments/[id]/answers/route"),
    import("@/app/api/self-assessments/[id]/submit/route"),
    import("@/app/api/pyq/topics/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    listRoute,
    planRoute,
    oneRoute,
    startRoute,
    answersRoute,
    submitRoute,
    topicsRoute,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Question: (await import("@/models/Question")).default,
    PracticeAnswer: (await import("@/models/PracticeAnswer")).default,
    SelfAssessment: (await import("@/models/SelfAssessment")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seed() {
  const { Tuition, User, Question, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const user = (email: string, role: string, extra: Record<string, unknown> = {}) =>
    User.create({ email, name: email, passwordHash: "x", role, tuitionId: tuition._id, emailVerified: true, ...extra });
  const student = await user("student@test.local", "student", { track: "JEE", standard: "11th" });
  const other = await user("other@test.local", "student", { track: "JEE", standard: "11th" });
  const teacher = await user("teacher@test.local", "teacher");
  tokens.student = await auth.signToken(student);
  tokens.other = await auth.signToken(other);
  tokens.teacher = await auth.signToken(teacher);
  // Programs without a question bank: legacy General and MHT-CET.
  tokens.general = await auth.signToken(await user("general@test.local", "student", { track: "General", standard: "11th" }));
  tokens.mhtcet = await auth.signToken(await user("mhtcet@test.local", "student", { track: "General", program: "MHT_CET_PCM", standard: "11th" }));
  ids.student = String(student._id);

  const paperId = new (await import("mongoose")).Types.ObjectId();
  let n = 0;
  const q = (topic: string, difficulty: string, extra: Record<string, unknown> = {}) => ({
    paperId,
    questionNumber: ++n,
    subject: "Physics",
    examCategory: "JEE/NEET",
    standard: "11th",
    chapter: "Kinematics",
    topic,
    difficulty,
    source: "JEE MAIN 2022",
    questionText: `Secret question ${n}`,
    optionA: "1",
    optionB: "2",
    optionC: "3",
    optionD: "4",
    correctAnswer: "A",
    answerType: "MCQ",
    explanation: `Secret solution ${n}`,
    ...extra,
  });
  const docs = [];
  for (const topic of ["Projectile Motion", "Relative Velocity"]) {
    for (let i = 0; i < 6; i++) docs.push(q(topic, "Easy"));
    for (let i = 0; i < 8; i++) docs.push(q(topic, "Medium"));
    for (let i = 0; i < 4; i++) docs.push(q(topic, "Hard"));
  }
  docs.push(q("Projectile Motion", "Easy", { correctAnswer: "" })); // can't be marked
  docs.push(q("Projectile Motion", "Easy", { source: "NEET 2020" })); // another track's exam
  await Question.insertMany(docs);
}

const req = (method: string, path: string, who: string, body?: unknown) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const setup = (extra: Record<string, unknown> = {}) => ({
  subject: "Physics",
  scope: [{ standard: "11th", chapter: "Kinematics", topics: [] }],
  count: 10,
  mix: "balanced",
  durationMinutes: 20,
  ...extra,
});
const ctx = (id: string) => ({ params: { id } });
const create = async (who = "student", body: unknown = setup(), status = 200) => json(await m.listRoute.POST(req("POST", "/api/self-assessments", who, body), {}), status);

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "self_assessment_test";
  process.env.JWT_SECRET = "self-assessment-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("self-assessment routes", () => {
  test("plan: counts by difficulty and topic, no question content", async () => {
    const body = await json(await m.planRoute.POST(req("POST", "/api/self-assessments/plan", "student", setup()), {}), 200);
    assert.ok(!JSON.stringify(body).includes("Secret"));
    assert.equal(body.plan.count, 10);
    assert.deepEqual(body.plan.byDifficulty, { Easy: 3, Medium: 5, Hard: 2 });
    assert.equal(body.plan.available.total, 36, "the unmarkable and other-track questions are left out");
    assert.deepEqual(body.topics.map((t: { topic: string; count: number }) => [t.topic, t.count]).sort(), [["Projectile Motion", 5], ["Relative Velocity", 5]]);
  });

  test("create → start → save → submit: marks it, reports by topic and counts it as practice", async () => {
    const made = await create();
    assert.equal(made.assessment.state, "ready");
    assert.equal(made.assessment.title, "Kinematics");
    assert.equal(made.questions.length, 0, "no questions before Start");
    const id = made.assessment.id;

    const started = await json(await m.startRoute.POST(req("POST", `/api/self-assessments/${id}/start`, "student"), ctx(id)), 200);
    assert.equal(started.assessment.state, "in-progress");
    assert.equal(started.questions.length, 10);
    assert.ok(started.assessment.deadline, "timed");
    assert.ok(started.questions.every((q: Record<string, unknown>) => q.correctAnswer === undefined && q.explanation === undefined), "no answers while taking it");

    // Right on every Relative Velocity question, wrong on Projectile Motion, one skipped.
    const skip = started.questions.find((q: { topic: string }) => q.topic === "Projectile Motion").index;
    const answers = started.questions.map((q: { index: number; topic: string }) => ({ index: q.index, selected: q.index === skip ? null : q.topic === "Relative Velocity" ? "A" : "B" }));
    await json(await m.answersRoute.PUT(req("PUT", `/api/self-assessments/${id}/answers`, "student", { answers }), ctx(id)), 200);

    const done = await json(await m.submitRoute.POST(req("POST", `/api/self-assessments/${id}/submit`, "student", {}), ctx(id)), 200);
    assert.equal(done.assessment.state, "submitted");
    assert.ok(done.questions.every((q: Record<string, unknown>) => q.correctAnswer === "A" && typeof q.explanation === "string"), "answers and solutions after");
    const rel = done.report.topics.find((t: { topic: string }) => t.topic === "Relative Velocity");
    const proj = done.report.topics.find((t: { topic: string }) => t.topic === "Projectile Motion");
    assert.equal(rel.level, "strong");
    assert.equal(proj.level, "weak");
    assert.equal(proj.strength, 0);
    assert.equal(proj.weakness, 100);
    assert.equal(proj.shareOfMistakes, 100);
    assert.equal(done.report.topics[0].topic, "Projectile Motion", "weakest first");
    const right = done.answers.filter((a: { correct: boolean | null }) => a.correct === true).length;
    assert.equal(done.assessment.result.score, right * 4 - (9 - right) * 1, "+4 / −1, skipped 0");

    const practice = await m.PracticeAnswer.countDocuments({ studentId: ids.student });
    assert.equal(practice, 9, "the 9 answered questions count as practice; the skipped one doesn't");
    const tree = await json(await m.topicsRoute.GET(req("GET", "/api/pyq/topics?subject=Physics", "student"), {}), 200);
    assert.equal(tree.chapters.find((c: { chapter: string }) => c.chapter === "Kinematics").answered, 9);

    const list = await json(await m.listRoute.GET(req("GET", "/api/self-assessments", "student"), {}), 200);
    assert.equal(list.assessments[0].id, id);
    assert.equal(list.assessments[0].result.weakTopics, 1);

    // Submitted: no more changes.
    await json(await m.answersRoute.PUT(req("PUT", `/api/self-assessments/${id}/answers`, "student", { answers }), ctx(id)), 400);
  });

  test("the test made from a plan's seed matches the plan", async () => {
    const plan = await json(await m.planRoute.POST(req("POST", "/api/self-assessments/plan", "student", setup({ count: 15, mix: "smart" })), {}), 200);
    assert.equal(typeof plan.seed, "number");
    const made = await create("student", setup({ count: 15, mix: "smart", seed: plan.seed }));
    assert.deepEqual(
      { Easy: made.assessment.plan.Easy, Medium: made.assessment.plan.Medium, Hard: made.assessment.plan.Hard },
      plan.plan.byDifficulty
    );
    assert.equal(made.assessment.plan.fresh, plan.plan.fresh);
    await json(await m.oneRoute.DELETE(req("DELETE", `/api/self-assessments/${made.assessment.id}`, "student"), ctx(made.assessment.id)), 200);
  });

  test("the next test prefers questions not answered yet", async () => {
    const made = await create("student", setup({ count: 20 }));
    const id = made.assessment.id;
    // 26 are new; the difficulty split comes first, so a level may run out of new ones in a topic.
    assert.ok(made.assessment.plan.fresh >= 18, `mostly new questions (${made.assessment.plan.fresh} of 20)`);
    await json(await m.oneRoute.DELETE(req("DELETE", `/api/self-assessments/${id}`, "student"), ctx(id)), 200);
  });

  test("Smart reads the student's history", async () => {
    const body = await json(await m.planRoute.POST(req("POST", "/api/self-assessments/plan", "student", setup({ mix: "smart" })), {}), 200);
    assert.equal(body.basis.answered, 9);
    const proj = body.topics.find((t: { topic: string }) => t.topic === "Projectile Motion");
    const rel = body.topics.find((t: { topic: string }) => t.topic === "Relative Velocity");
    assert.equal(proj.level, "weak");
    assert.ok(proj.count > rel.count, "the weak topic gets more questions");
  });

  test("time up: it submits itself with the saved answers", async () => {
    const made = await create();
    const id = made.assessment.id;
    await json(await m.startRoute.POST(req("POST", `/api/self-assessments/${id}/start`, "student"), ctx(id)), 200);
    await m.SelfAssessment.updateOne({ _id: id }, { startedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const later = await json(await m.oneRoute.GET(req("GET", `/api/self-assessments/${id}`, "student"), ctx(id)), 200);
    assert.equal(later.assessment.state, "submitted");
    assert.equal(later.assessment.result.timeTakenSeconds, 20 * 60, "capped at the time limit");
    assert.equal(later.assessment.result.skipped, 10);
  });

  test("untimed tests have no deadline", async () => {
    const made = await create("student", setup({ durationMinutes: null }));
    const id = made.assessment.id;
    const started = await json(await m.startRoute.POST(req("POST", `/api/self-assessments/${id}/start`, "student"), ctx(id)), 200);
    assert.equal(started.assessment.deadline, null);
  });

  test("only the student who made it sees it; students only; choices are checked", async () => {
    const made = await create();
    const id = made.assessment.id;
    await json(await m.oneRoute.GET(req("GET", `/api/self-assessments/${id}`, "other"), ctx(id)), 404);
    await create("teacher", setup(), 403);
    await create("student", setup({ subject: "Biology" }), 400);
    await create("student", setup({ scope: [] }), 400);
    await create("student", setup({ count: 3 }), 400);
    await create("student", setup({ count: 51 }), 400);
    await create("student", setup({ mix: "random" }), 400);
    await create("student", setup({ scope: [{ standard: "12th", chapter: "Kinematics", topics: [] }] }), 400);
  });

  test("programs without a question bank can't plan or make one (no JEE/NEET fallback)", async () => {
    for (const who of ["general", "mhtcet"]) {
      const plan = await json(await m.planRoute.POST(req("POST", "/api/self-assessments/plan", who, setup()), {}), 400);
      assert.match(plan.error, /aren't available/);
      await create(who, setup(), 400);
    }
  });
});
