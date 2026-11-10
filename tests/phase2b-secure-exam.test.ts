// Secure exam: violations suspend the attempt for a teacher decision, keeping
// saved answers. Short interruptions continue. Disposable replica-set database.
// Run with: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const MIN = 60_000;
const HOUR = 60 * MIN;

let mongod: MongoMemoryReplSet;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [listRoute, overviewRoute, testRoute, startRoute, answersRoute, submitRoute, eventsRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/route"),
    import("@/app/api/student/overview/route"),
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/answers/route"),
    import("@/app/api/tests/[id]/submit/route"),
    import("@/app/api/tests/[id]/events/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    listRoute,
    overviewRoute,
    testRoute,
    startRoute,
    answersRoute,
    submitRoute,
    eventsRoute,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Question: (await import("@/models/Question")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let bankDigest = "";

async function bank() {
  const docs = await m.Question.collection.find({}).sort({ _id: 1 }).toArray();
  return `${docs.length}:${createHash("sha256").update(JSON.stringify(docs)).digest("hex")}`;
}

async function seed() {
  const { Tuition, User, Batch, Question, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const other = await Tuition.create({ name: "Tuition B" });
  const user = (email: string, role: string, t = tuition) => User.create({ email, name: email, passwordHash: "x", role, tuitionId: t._id, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const batch2 = await Batch.create({ tuitionId: tuition._id, name: "12 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const otherBatch = await Batch.create({ tuitionId: other._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [] });
  for (const [key, batchDoc, t] of [
    ["s1", batch, tuition],
    ["s2", batch, tuition],
    ["s3", batch, tuition],
    ["s4", batch2, tuition],
    ["s5", otherBatch, other],
  ] as const) {
    const u = await user(`${key}@test.local`, "student", t);
    await User.updateOne({ _id: u._id }, { batchId: batchDoc._id });
    tokens[key] = await auth.signToken((await User.findById(u._id))!);
    ids[key] = String(u._id);
  }
  tokens.teacher = await auth.signToken(teacher);
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);
  ids.tuition = String(tuition._id);

  await Question.insertMany(
    ["One", "Two", "Three"].map((word, i) => ({
      paperId: tuition._id,
      questionNumber: i + 1,
      examCategory: "JEE/NEET",
      subject: "Physics",
      standard: "11th",
      chapter: "Kinematics",
      topic: "Motion",
      questionText: `Question ${word}`,
      optionA: "1",
      optionB: "2",
      optionC: "3",
      optionD: "4",
      correctAnswer: "ABC"[i],
      explanation: `Solution ${word}`,
    }))
  );
  bankDigest = await bank();
}

/** A test room made directly, so its times can be anything. Answers: A, B, C. */
async function room(over: { opensAt?: Date; closesAt?: Date; durationMinutes?: number; batchId?: string } = {}) {
  const q = (word: string, correctAnswer: string) => ({
    subject: "Physics",
    questionText: `Question ${word}`,
    optionA: "1",
    optionB: "2",
    optionC: "3",
    optionD: "4",
    correctAnswer,
    explanation: `Solution ${word}`,
  });
  const doc = await m.TestRoom.create({
    tuitionId: ids.tuition,
    batchId: over.batchId ?? ids.batch,
    teacherId: ids.teacher,
    title: "Session test",
    subject: "Physics",
    questions: [q("One", "A"), q("Two", "B"), q("Three", "C")],
    marksPerQuestion: 4,
    negativeMarks: 1,
    durationMinutes: over.durationMinutes ?? 60,
    opensAt: over.opensAt ?? new Date(Date.now() - HOUR),
    closesAt: over.closesAt ?? new Date(Date.now() + 5 * HOUR),
  });
  return String(doc._id);
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

const start = async (id: string, who = "s1", status = 200) => json(await startRaw(id, who), status);
const startRaw = (id: string, who = "s1") => m.startRoute.POST(req("POST", `/api/tests/${id}/start`, who), { params: { id } });
const save = async (id: string, answers: unknown, who = "s1", status = 200) =>
  json(await m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, who, { answers }), { params: { id } }), status);
const submit = async (id: string, body: unknown = {}, who = "s1", status = 200) =>
  json(await m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, who, body), { params: { id } }), status);
const view = async (id: string, who: string, status = 200) => json(await m.testRoute.GET(req("GET", `/api/tests/${id}`, who), { params: { id } }), status);
const closeNow = async (id: string, status = 200) => json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), { params: { id } }), status);
const attemptsOf = (id: string) => m.TestAttempt.find({ testId: id }).lean<{ studentId: unknown; startedAt: Date; submittedAt: Date | null; score: number; answers: { index: number; selected: string | null }[] }[]>();
const backdate = (id: string, who: string, ms: number) => m.TestAttempt.updateOne({ testId: id, studentId: ids[who] }, { startedAt: new Date(Date.now() - ms) });

const away = async (id: string, body: unknown, who = "s1", status = 200) =>
  json(await m.eventsRoute.POST(req("POST", `/api/tests/${id}/events`, who, body), { params: { id } }), status);

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase2b_secure_exam";
  process.env.JWT_SECRET = "phase2b-test-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await m.TestAttempt.init();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

const doc = (id: string, who = "s1") =>
  m.TestAttempt.findOne({ testId: id, studentId: ids[who] }).lean<{
    submittedAt: Date | null;
    endedReason: string | null;
    events: { awayMs: number; ended: boolean }[];
    answers: { index: number; selected: string | null }[];
  }>();

describe("secure exam: interruptions", () => {
  test("a short interruption is recorded but the attempt carries on with the same deadline", async () => {
    const id = await room();
    const first = await start(id);
    const body = await away(id, { type: "away", awayMs: 3000 });
    assert.equal(body.attempt.state, "in-progress");
    assert.equal(body.attempt.endedReason, null);
    assert.equal(body.attempt.deadline, first.attempt.deadline);
    const a = await doc(id);
    assert.equal(a!.submittedAt, null);
    assert.deepEqual(a!.events.map((e) => [e.awayMs, e.ended]), [[3000, false]]);
    await save(id, [{ index: 0, selected: "A" }]);
  });

  test("being away longer than the limit suspends with saved answers and frozen remaining time", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    const body = await away(id, { type: "away", awayMs: 60_000, answers: [{ index: 1, selected: "B" }] });
    assert.equal(body.attempt.state, "suspended");
    assert.equal(body.attempt.endedReason, "violation");
    assert.deepEqual(body.attempt.answers.map((a: { selected: string | null }) => a.selected), ["A", "B"]);
    const a = await doc(id);
    assert.equal(a!.submittedAt, null);
    assert.ok(body.attempt.remainingMs > 0);
    assert.equal(a!.endedReason, "violation");
    assert.deepEqual(a!.events.map((e) => e.ended), [true]);
  });

  test("a suspended attempt cannot be resumed, edited or submitted by the student", async () => {
    const id = await room();
    await start(id);
    await away(id, { type: "away", awayMs: 60_000 });
    const again = await start(id);
    assert.equal(again.attempt.state, "suspended");
    assert.equal(again.attempt.endedReason, "violation");
    assert.equal((await attemptsOf(id)).length, 1);
    await save(id, [{ index: 0, selected: "A" }], "s1", 409);
    await submit(id, { answers: [{ index: 0, selected: "A" }] }, 's1', 409);
    // Reporting again changes nothing.
    const repeat = await away(id, { type: "away", awayMs: 1 });
    assert.equal(repeat.attempt.endedReason, "violation");
    assert.equal((await doc(id))!.events.length, 1);
  });

  test("results stay hidden until the test closes, violation or not", async () => {
    const id = await room();
    await start(id);
    const body = await away(id, { type: "away", awayMs: 60_000, answers: [{ index: 0, selected: "A" }] });
    assert.equal(body.attempt.result, null);
    assert.ok(!/correctAnswer|explanation|Solution/.test(JSON.stringify(body)));
    await closeNow(id);
    assert.equal((await view(id, "s1")).attempt.result.score, 4);
  });

  test("a normal submit has no end reason", async () => {
    const id = await room();
    await start(id);
    assert.equal((await submit(id)).attempt.endedReason, null);
  });

  test("an interruption can't extend the deadline: time that ran out still scores what was saved", async () => {
    const id = await room({ durationMinutes: 10 });
    await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    await backdate(id, "s1", 11 * MIN);
    const body = await away(id, { type: "away", awayMs: 1000 });
    assert.equal(body.attempt.state, "submitted");
    assert.equal(body.attempt.endedReason, null);
    assert.equal((await doc(id))!.answers[0].selected, "A");
  });

  test("bad reports are refused and an event needs a started attempt", async () => {
    const id = await room();
    await away(id, { type: "away", awayMs: 1000 }, "s1", 400);
    await start(id);
    await away(id, { type: "other", awayMs: 1000 }, "s1", 400);
    await away(id, { type: "away", awayMs: -5 }, "s1", 400);
    await away(id, { type: "away", awayMs: "long" }, "s1", 400);
    assert.equal((await doc(id))!.events.length, 0);
    assert.equal((await doc(id))!.submittedAt, null);
  });

  test("a confirmed violation preserves a valid final answer list without scoring", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    const body = await away(id, { type: "away", awayMs: 10_001, answers: [{ index: 1, selected: "B" }, { index: 2, selected: "D" }] });
    assert.equal(body.attempt.endedReason, "violation");
    assert.deepEqual(body.attempt.answers.map((a: { selected: string | null }) => a.selected), ["A", "B", "D"]);
  });

  // Invalid answers are never stored and cannot prevent suspension.
  const badAnswers: [string, unknown][] = [
    ["an index outside the test", [{ index: 9, selected: "A" }]],
    ["a negative or fractional index", [{ index: -1, selected: "A" }, { index: 1.5, selected: "A" }]],
    ["an option that doesn't exist", [{ index: 1, selected: "Z" }]],
    ["a list longer than the test", [0, 1, 2, 0].map((index) => ({ index, selected: "A" }))],
    ["a payload that isn't a list", "all of them"],
    ["entries that aren't answers", [null, 7, "x"]],
    ["a valid answer next to an invalid one", [{ index: 1, selected: "B" }, { index: 9, selected: "A" }]],
  ];
  for (const [label, answers] of badAnswers) {
    test(`a confirmed violation still suspends when it carries ${label}; saved answers remain intact`, async () => {
      const id = await room();
      await start(id);
      await save(id, [{ index: 0, selected: "A" }]);
      const body = await away(id, { type: "away", awayMs: 60_000, answers });
      assert.equal(body.attempt.state, "suspended");
      assert.equal(body.attempt.endedReason, "violation");
      assert.deepEqual(body.attempt.answers.map((a: { selected: string | null }) => a.selected), ["A"]);
      const a = await doc(id);
      assert.equal(a!.submittedAt, null);
      assert.equal(a!.endedReason, "violation");
      assert.deepEqual(a!.events.map((e) => e.ended), [true]);
      // Nothing more can be done to it.
      await save(id, [{ index: 1, selected: "B" }], "s1", 409);
      assert.equal((await start(id)).attempt.state, "suspended");
    });
  }

  test("an interruption of exactly the limit does not end the attempt", async () => {
    const id = await room();
    await start(id);
    const body = await away(id, { type: "away", awayMs: 10_000, answers: [{ index: 9, selected: "A" }] });
    assert.equal(body.attempt.state, "in-progress");
    assert.equal((await doc(id))!.submittedAt, null);
  });

  test("repeated violation reports leave one unchanged suspension", async () => {
    const id = await room();
    await start(id);
    const first = await away(id, { type: "away", awayMs: 60_000, answers: [{ index: 9, selected: "A" }] });
    const again = await away(id, { type: "away", awayMs: 90_000, answers: [{ index: 0, selected: "A" }] });
    assert.equal(again.attempt.suspendedAt, first.attempt.suspendedAt);
    assert.equal(again.attempt.result, null);
    assert.ok(again.attempt.answers.every((a: { selected: string | null }) => a.selected === null));
    assert.equal((await attemptsOf(id)).length, 1);
    assert.equal((await doc(id))!.events.length, 1);
  });

  test("answers saved concurrently with a violation are preserved or refused", async () => {
    const id = await room();
    await start(id);
    const saves = [0, 1, 2].map((index) => m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, "s1", { answers: [{ index, selected: "ABC"[index] }] }), { params: { id } }));
    const report = m.eventsRoute.POST(req("POST", `/api/tests/${id}/events`, "s1", { type: "away", awayMs: 60_000, answers: [{ index: 9, selected: "A" }] }), { params: { id } });
    const results = await Promise.all([...saves, report]);
    assert.equal(results[3].status, 200);
    const a = await doc(id);
    assert.equal(a!.submittedAt, null);
    const kept = new Map(a!.answers.map((x) => [x.index, x.selected]));
    results.slice(0, 3).forEach((r, index) => {
      // An acknowledged save (200) is in the final answers.
      if (r.status === 200) assert.equal(kept.get(index), "ABC"[index]);
      else assert.equal(r.status, 409);
    });
  });

  test("expired attempts with invalid answers in a violation report are still finalized once", async () => {
    const id = await room({ durationMinutes: 10 });
    await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    await backdate(id, "s1", 11 * MIN);
    const body = await away(id, { type: "away", awayMs: 60_000, answers: [{ index: 9, selected: "A" }] });
    assert.equal(body.attempt.state, "submitted");
    assert.equal((await doc(id))!.answers[0].selected, "A");
  });

  test("a violation report can't be used without logging in or across students", async () => {
    const id = await room();
    await start(id, "s1");
    const res = await m.eventsRoute.POST(new NextRequest(`${BASE}/api/tests/${id}/events`, { method: "POST", body: JSON.stringify({ type: "away", awayMs: 60_000 }) }), { params: { id } });
    assert.equal(res.status, 401);
    await away(id, { type: "away", awayMs: 60_000 }, "s4", 404);
    assert.equal((await doc(id))!.submittedAt, null);
  });

  test("only the student's own attempt is affected, and only students can report", async () => {
    const id = await room();
    await start(id, "s1");
    await start(id, "s2");
    await away(id, { type: "away", awayMs: 60_000 }, "s1");
    assert.equal((await doc(id, "s2"))!.submittedAt, null);
    await away(id, { type: "away", awayMs: 60_000 }, "teacher", 403);
    await away(id, { type: "away", awayMs: 60_000 }, "s5", 404);
  });

  test("simultaneous reports end the attempt once", async () => {
    const id = await room();
    await start(id, "s3");
    const res = await Promise.all(Array.from({ length: 4 }, () => m.eventsRoute.POST(req("POST", `/api/tests/${id}/events`, "s3", { type: "away", awayMs: 60_000 }), { params: { id } })));
    for (const r of res) assert.equal(r.status, 200);
    assert.equal((await attemptsOf(id)).length, 1);
    assert.equal((await doc(id, "s3"))!.endedReason, "violation");
  });

  test("the question bank was never changed by any of this", async () => {
    assert.equal(await bank(), bankDigest);
  });
});
