// Engagement Phase 0: the real route handlers — GET /api/engagement/me
// (students only, flag off), the hooks in practice answers, self-assessment
// submit and every test-finish path (submit, Close Now, teacher finalize,
// results release), old response fields unchanged, and a failing engine never
// breaking answering, submitting or tests.
// Run with: npm test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const MIN = 60_000;
const HOUR = 60 * MIN;

let mongod: MongoMemoryReplSet;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  return {
    me: await import("@/app/api/engagement/me/route"),
    answer: await import("@/app/api/pyq/answer/route"),
    selfSubmit: await import("@/app/api/self-assessments/[id]/submit/route"),
    start: await import("@/app/api/tests/[id]/start/route"),
    answers: await import("@/app/api/tests/[id]/answers/route"),
    submit: await import("@/app/api/tests/[id]/submit/route"),
    testRoute: await import("@/app/api/tests/[id]/route"),
    controls: await import("@/app/api/tests/[id]/attempt-control/route"),
    events: await import("@/app/api/tests/[id]/events/route"),
    attempts: await import("@/lib/attempts"),
    completion: await import("@/lib/test-completion"),
    selfLib: await import("@/lib/self-assessment"),
    award: await import("@/lib/engagement/award"),
    auth: await import("@/lib/auth"),
    db: await import("@/lib/db"),
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Question: (await import("@/models/Question")).default,
    PracticeAnswer: (await import("@/models/PracticeAnswer")).default,
    SelfAssessment: (await import("@/models/SelfAssessment")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
    XpEvent: (await import("@/models/XpEvent")).default,
    DailyActivity: (await import("@/models/DailyActivity")).default,
    StudentEngagement: (await import("@/models/StudentEngagement")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const questions: string[] = [];

async function seed() {
  const { Tuition, User, Batch, Question, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const off = await Tuition.create({ name: "Tuition Off", engagement: { enabled: false } });
  const user = (email: string, role: string, t = tuition, extra: Record<string, unknown> = {}) =>
    User.create({ email, name: email, passwordHash: "x", role, tuitionId: t._id, emailVerified: true, ...extra });
  const teacher = await user("teacher@test.local", "teacher");
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", standard: "11th", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const offBatch = await Batch.create({ tuitionId: off._id, name: "11 JEE", track: "JEE", standard: "11th", subjects: ["Physics"], teachers: [] });
  for (const key of ["s1", "s2", "s3", "s4", "s5", "s6", "s7"]) {
    const u = await user(`${key}@test.local`, "student", tuition, { track: "JEE", standard: "11th", batchId: batch._id });
    tokens[key] = await auth.signToken(u);
    ids[key] = String(u._id);
  }
  const offStudent = await user("off@test.local", "student", off, { track: "JEE", standard: "11th", batchId: offBatch._id });
  tokens.off = await auth.signToken(offStudent);
  ids.off = String(offStudent._id);
  tokens.teacher = await auth.signToken(teacher);
  // A teacher with a track has a practice bank, so the route checks (but doesn't save) their answers.
  tokens.checker = await auth.signToken(await user("checker@test.local", "teacher", tuition, { track: "JEE", standard: "11th" }));
  const admin = await user("admin@test.local", "tuition");
  tokens.admin = await auth.signToken(admin);
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);
  ids.tuition = String(tuition._id);

  const paperId = new (await import("mongoose")).Types.ObjectId();
  for (let n = 1; n <= 12; n++) {
    const q = await Question.create({
      paperId, questionNumber: n, subject: "Physics", examCategory: "JEE/NEET", standard: "11th",
      chapter: "Kinematics", topic: "Projectile Motion", source: "JEE MAIN 2022", difficulty: "Medium",
      questionText: `Question ${n}`, optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer: "A", answerType: "MCQ", explanation: `Solution ${n}`,
    });
    questions.push(String(q._id));
  }
}

function req(method: string, path: string, who: string, body?: unknown) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const getMe = async (who: string, status = 200) => json(await m.me.GET(req("GET", "/api/engagement/me", who), {}), status);
const answer = async (who: string, questionId: string, selected: string, status = 200) =>
  json(await m.answer.POST(req("POST", "/api/pyq/answer", who, { questionId, selected }), {}), status);
const start = async (id: string, who: string) => json(await m.start.POST(req("POST", `/api/tests/${id}/start`, who), { params: { id } }), 200);
const submit = async (id: string, who: string, body: unknown = {}) => json(await m.submit.POST(req("POST", `/api/tests/${id}/submit`, who, body), { params: { id } }), 200);
const away = async (id: string, who: string) =>
  json(await m.events.POST(req("POST", `/api/tests/${id}/events`, who, { type: "away", awayMs: m.attempts.AWAY_LIMIT_MS + 5000, resumeVersion: 0 }), { params: { id } }), 200);
const control = async (id: string, who: string, action: string, extra: Record<string, unknown> = {}) =>
  json(await m.controls.POST(req("POST", `/api/tests/${id}/attempt-control`, "teacher", { studentId: ids[who], action, requestId: randomUUID(), ...extra }), { params: { id } }), 200);
const stored = (id: string, who: string) => m.TestAttempt.findOne({ testId: id, studentId: ids[who] });
const testXp = (id: string, who: string) => m.XpEvent.findOne({ key: `test:${ids[who]}:${id}` }).lean<{ xp: number; kind: string } | null>();

async function room() {
  const q = (word: string, correctAnswer: string) => ({
    subject: "Physics", questionText: `Question ${word}`, optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer, explanation: `Solution ${word}`,
  });
  const doc = await m.TestRoom.create({
    tuitionId: ids.tuition, batchId: ids.batch, teacherId: ids.teacher, title: "Engagement test", subject: "Physics",
    questions: [q("One", "A"), q("Two", "B"), q("Three", "C")], marksPerQuestion: 4, negativeMarks: 1, durationMinutes: 60,
    opensAt: new Date(Date.now() - HOUR), closesAt: new Date(Date.now() + 5 * HOUR),
  });
  return String(doc._id);
}

async function selfAssessment(who: string) {
  const q = (n: number) => ({ subject: "Physics", standard: "11th", chapter: "Kinematics", topic: "Projectile Motion", difficulty: "Medium",
    questionText: `Self ${n}`, optionA: "1", optionB: "2", optionC: "3", optionD: "4", answerType: "MCQ", correctAnswer: "A", explanation: `Self solution ${n}` });
  const doc = await m.SelfAssessment.create({
    tuitionId: ids.tuition, studentId: ids[who], subject: "Physics", title: "My test",
    scope: [{ standard: "11th", chapter: "Kinematics", topics: [] }],
    questions: [q(1), q(2), q(3), q(4), q(5)], startedAt: new Date(Date.now() - 10 * MIN),
    answers: [{ index: 0, selected: "A" }, { index: 1, selected: "B" }, { index: 2, selected: "A" }, { index: 3, selected: null }],
  });
  return String(doc._id);
}

const PYQ_KEYS = ["correct", "correctAnswer", "explanation", "explanationDiagramUrls", "saved", "selected"];
const without = <T extends Record<string, unknown>>(o: T, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "engagement_routes";
  process.env.JWT_SECRET = "engagement-routes-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await Promise.all([m.TestAttempt.init(), m.XpEvent.init(), m.DailyActivity.init(), m.StudentEngagement.init(), m.PracticeAnswer.init()]);
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("GET /api/engagement/me", () => {
  test("a new student starts at zero on the Regular goal", async () => {
    const me = await getMe("s7");
    assert.equal(me.enabled, true);
    assert.deepEqual(me.xp, { total: 0, level: 1, levelStartXp: 0, nextLevelXp: 100, intoLevel: 0, toNext: 100, progress: 0 });
    assert.equal(me.today.xp, 0);
    assert.equal(me.today.goal, 100);
    assert.equal(me.today.goalKey, "regular");
    assert.equal(me.today.goalMet, false);
    assert.deepEqual(me.streak, { current: 0, longest: 0, freezes: 0, maxFreezes: 2, securedToday: false });
  });

  test("students only: teachers and the tuition get 403, no login gets 401", async () => {
    await getMe("teacher", 403);
    await getMe("admin", 403);
    const res = await m.me.GET(new NextRequest(`${BASE}/api/engagement/me`), {});
    assert.equal(res.status, 401);
  });

  test("engagement switched off for the tuition: { enabled: false }", async () => {
    assert.deepEqual(await getMe("off"), { enabled: false });
  });
});

describe("POST /api/pyq/answer", () => {
  test("practise 3 questions: each response carries the updated progress, matching /me", async () => {
    const replies = [];
    for (const [i, selected] of (["A", "B", "A"] as const).entries()) replies.push(await answer("s1", questions[i], selected));
    for (const reply of replies) {
      assert.deepEqual(Object.keys(without(reply, "engagement")).sort(), PYQ_KEYS, "old fields unchanged");
      assert.equal(reply.saved, true);
      assert.equal(reply.engagement.enabled, true);
    }
    assert.deepEqual(replies.map((r) => r.engagement.xpAwarded), [15, 2, 15]); // Medium right = 15, wrong = 2
    assert.deepEqual(replies.map((r) => r.engagement.me.today.xp), [15, 17, 32]);
    const me = await getMe("s1");
    assert.deepEqual(me, replies[2].engagement.me);
    assert.equal(await m.PracticeAnswer.countDocuments({ studentId: ids.s1 }), 3, "answers are still saved");
  });

  test("re-answering a right one earns nothing; fixing a wrong one earns 15", async () => {
    assert.equal((await answer("s1", questions[0], "A")).engagement.xpAwarded, 0);
    const fix = await answer("s1", questions[1], "A");
    assert.equal(fix.correct, true);
    assert.equal(fix.engagement.xpAwarded, 15);
    assert.equal((await answer("s1", questions[1], "A")).engagement.xpAwarded, 0);
  });

  test("a teacher's check is unchanged: no engagement field, nothing saved", async () => {
    const reply = await answer("checker", questions[0], "A");
    assert.deepEqual(Object.keys(reply).sort(), PYQ_KEYS);
    assert.equal(reply.saved, false);
  });

  test("flag off: the answer is saved and engagement is { enabled: false }", async () => {
    const reply = await answer("off", questions[0], "A");
    assert.equal(reply.saved, true);
    assert.deepEqual(reply.engagement, { enabled: false });
    assert.equal(await m.XpEvent.countDocuments({ studentId: ids.off }), 0);
  });
});

describe("POST /api/self-assessments/[id]/submit", () => {
  test("3 XP per attempted question; the old result is unchanged", async () => {
    const id = await selfAssessment("s2");
    const reply = await json(await m.selfSubmit.POST(req("POST", `/api/self-assessments/${id}/submit`, "s2", {}), { params: { id } }), 200);
    assert.equal(reply.engagement.xpAwarded, 9);
    const doc = await m.SelfAssessment.findById(id);
    assert.deepEqual(without(reply, "engagement"), JSON.parse(JSON.stringify(m.selfLib.detailOf(doc))));
    const again = await json(await m.selfSubmit.POST(req("POST", `/api/self-assessments/${id}/submit`, "s2", {}), { params: { id } }), 200);
    assert.equal(again.engagement.duplicate, true);
    assert.equal(again.engagement.me.xp.total, 9);
  });
});

describe("test finish paths (participation XP after the lock)", () => {
  test("student submit: 80 XP once, streak day, the old fields unchanged", async () => {
    const id = await room();
    await start(id, "s3");
    const reply = await submit(id, "s3", { answers: [{ index: 0, selected: "A" }], resumeVersion: 0 });
    assert.deepEqual(Object.keys(reply).sort(), ["attempt", "engagement", "questions"]);
    assert.equal(reply.attempt.state, "submitted");
    assert.equal(reply.engagement.me.xp.total, 80);
    assert.equal(reply.engagement.me.streak.securedToday, true, "exam-day protection");
    assert.equal(reply.engagement.me.today.goalMet, false);
    assert.equal((await testXp(id, "s3"))?.xp, 80);
    const again = await submit(id, "s3");
    assert.equal(again.engagement.me.xp.total, 80);
    assert.equal(await m.XpEvent.countDocuments({ studentId: ids.s3, kind: "test.submitted" }), 1);
  });

  test("never while paused; teacher finalize awards after the lock", async () => {
    const id = await room();
    await start(id, "s4");
    await away(id, "s4");
    const paused = await stored(id, "s4");
    assert.ok(paused.suspendedAt, "the attempt is paused");
    assert.equal(await testXp(id, "s4"), null, "no XP while paused");
    const reply = await control(id, "s4", "finalize", { suspendedAt: paused.suspendedAt.toISOString() });
    assert.equal("engagement" in reply, false, "the teacher's response is unchanged");
    assert.ok((await stored(id, "s4")).submittedAt);
    assert.equal((await testXp(id, "s4"))?.xp, 80);
  });

  test("Close Now finishes open attempts and awards each", async () => {
    const id = await room();
    await start(id, "s5");
    await json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), { params: { id } }), 200);
    assert.ok((await stored(id, "s5")).submittedAt);
    assert.equal((await testXp(id, "s5"))?.xp, 80);
  });

  test("closing finishes and awards an expired attempt; a paused one waits for the teacher with no XP", async () => {
    const id = await room();
    await start(id, "s5");
    await start(id, "s6");
    await away(id, "s6");
    assert.equal(await testXp(id, "s6"), null);
    await m.TestRoom.updateOne({ _id: id }, { closesAt: new Date(Date.now() - MIN) });
    // The paused attempt keeps the room pending until a teacher decides (main's rule).
    assert.equal(await m.completion.completionReleased({ _id: id }), false);
    assert.ok((await stored(id, "s5")).submittedAt);
    assert.equal((await testXp(id, "s5"))?.xp, 80);
    assert.equal((await stored(id, "s6")).submittedAt, null);
    assert.equal(await testXp(id, "s6"), null);
  });
});

describe("a failing engine never breaks learning or tests", () => {
  test("answering, self-assessment submit, test submit and teacher finalize all succeed", async () => {
    const original = m.award.engine.award;
    m.award.engine.award = async () => {
      throw new Error("engine down");
    };
    try {
      const reply = await answer("s7", questions[5], "A");
      assert.deepEqual(Object.keys(without(reply, "engagement")).sort(), PYQ_KEYS);
      assert.equal(reply.correct, true);
      assert.equal(reply.saved, true);
      assert.equal(reply.engagement, null);
      assert.ok(await m.PracticeAnswer.exists({ studentId: ids.s7, questionId: questions[5] }));

      const sid = await selfAssessment("s7");
      const self = await json(await m.selfSubmit.POST(req("POST", `/api/self-assessments/${sid}/submit`, "s7", {}), { params: { id: sid } }), 200);
      assert.equal(self.engagement, null);
      assert.ok((await m.SelfAssessment.findById(sid)).submittedAt);
      assert.deepEqual(without(self, "engagement"), JSON.parse(JSON.stringify(m.selfLib.detailOf((await m.SelfAssessment.findById(sid))!))));

      const id = await room();
      await start(id, "s7");
      const done = await submit(id, "s7", { answers: [{ index: 0, selected: "A" }], resumeVersion: 0 });
      assert.equal(done.attempt.state, "submitted");
      assert.equal(done.engagement, null);

      const id2 = await room();
      await start(id2, "s7");
      await away(id2, "s7");
      const paused = await stored(id2, "s7");
      await control(id2, "s7", "finalize", { suspendedAt: paused.suspendedAt.toISOString() });
      assert.ok((await stored(id2, "s7")).submittedAt);

      const id3 = await room();
      await start(id3, "s7");
      await json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id3}`, "teacher", { closeNow: true }), { params: { id: id3 } }), 200);
      assert.ok((await stored(id3, "s7")).submittedAt);

      assert.equal(await m.XpEvent.countDocuments({ studentId: ids.s7 }), 0);
    } finally {
      m.award.engine.award = original;
    }
  });
});
