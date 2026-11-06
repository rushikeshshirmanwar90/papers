// Phase 2A: a student's test session — start once, save, resume with the same
// deadline, score on expiry or Close Now. Runs the real route handlers against
// a throwaway in-memory MongoDB.
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
  const [listRoute, overviewRoute, testRoute, startRoute, answersRoute, submitRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/route"),
    import("@/app/api/student/overview/route"),
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/answers/route"),
    import("@/app/api/tests/[id]/submit/route"),
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

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase2a_test_session";
  process.env.JWT_SECRET = "phase2a-test-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await m.TestAttempt.init(); // the unique index must exist before the concurrency tests
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("starting and resuming", () => {
  test("the first start creates one attempt with a server deadline and clock", async () => {
    const id = await room();
    const before = Date.now();
    const body = await start(id);
    assert.equal(body.attempt.state, "in-progress");
    const started = new Date(body.attempt.startedAt).getTime();
    assert.ok(started >= before - 1000 && started <= Date.now() + 1000);
    assert.equal(new Date(body.attempt.deadline).getTime(), started + 60 * MIN);
    assert.ok(Math.abs(new Date(body.attempt.serverTime).getTime() - Date.now()) < 5000);
    assert.equal((await attemptsOf(id)).length, 1);
  });

  test("starting again resumes the same attempt: same startedAt, same deadline", async () => {
    const id = await room();
    const first = await start(id);
    const again = await start(id);
    assert.equal(again.attempt.startedAt, first.attempt.startedAt);
    assert.equal(again.attempt.deadline, first.attempt.deadline);
    assert.equal((await attemptsOf(id)).length, 1);
  });

  test("simultaneous starts make exactly one attempt", async () => {
    const id = await room();
    const results = await Promise.all(Array.from({ length: 6 }, () => startRaw(id, "s2")));
    const bodies = await Promise.all(results.map((r) => r.json()));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(bodies));
    assert.equal(new Set(bodies.map((b) => b.attempt.startedAt)).size, 1);
    assert.equal((await attemptsOf(id)).length, 1);
  });

  test("resuming after time has passed does not reset the timer, and brings the saved answers back", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "A" }, { index: 2, selected: "D" }]);
    await backdate(id, "s1", 20 * MIN);
    const body = await start(id);
    const left = new Date(body.attempt.deadline).getTime() - Date.now();
    assert.ok(left > 39 * MIN && left < 41 * MIN, `about 40 minutes left, got ${left / MIN}`);
    assert.deepEqual(
      body.attempt.answers.map((a: { index: number; selected: string }) => [a.index, a.selected]),
      [[0, "A"], [2, "D"]]
    );
    const viewed = await view(id, "s1");
    assert.equal(viewed.attempt.startedAt, body.attempt.startedAt);
  });

  test("the deadline is the earlier of the time limit and the test closing", async () => {
    const id = await room({ closesAt: new Date(Date.now() + 90 * MIN), durationMinutes: 60 });
    const body = await start(id);
    assert.equal(new Date(body.attempt.deadline).getTime(), new Date(body.attempt.startedAt).getTime() + 60 * MIN);
    // Someone resuming late in a window that closes before their limit ends.
    const shortId = await room({ opensAt: new Date(Date.now() - HOUR), closesAt: new Date(Date.now() + 65 * MIN), durationMinutes: 60 });
    await start(shortId, "s2");
    await m.TestRoom.updateOne({ _id: shortId }, { closesAt: new Date(Date.now() + 10 * MIN) });
    const view2 = await start(shortId, "s2");
    assert.ok(Math.abs(new Date(view2.attempt.deadline).getTime() - (Date.now() + 10 * MIN)) < 5000);
  });

  test("a test that hasn't opened, has closed, or has no time left to start is refused", async () => {
    await start(await room({ opensAt: new Date(Date.now() + HOUR), closesAt: new Date(Date.now() + 5 * HOUR) }), "s1", 400);
    await start(await room({ opensAt: new Date(Date.now() - 3 * HOUR), closesAt: new Date(Date.now() - HOUR) }), "s1", 400);
    await start(await room({ closesAt: new Date(Date.now() + 30 * MIN), durationMinutes: 60 }), "s1", 400);
  });
});

describe("saving answers", () => {
  test("answers persist, repeated saves are safe, and a blank clears an answer", async () => {
    const id = await room();
    await start(id);
    assert.equal((await save(id, [{ index: 1, selected: "b" }])).saved, 1);
    assert.equal((await save(id, [{ index: 1, selected: "B" }])).saved, 1);
    assert.equal((await save(id, [{ index: 1, selected: "C" }, { index: 0, selected: "A" }])).saved, 2);
    const [row] = await attemptsOf(id);
    assert.deepEqual(row.answers.map((a) => [a.index, a.selected]).sort(), [[0, "A"], [1, "C"]]);
    assert.equal((await save(id, [{ index: 1, selected: null }])).saved, 1);
  });

  test("invalid question numbers and options are refused, and change nothing", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    await save(id, [{ index: 3, selected: "A" }], "s1", 400);
    await save(id, [{ index: -1, selected: "A" }], "s1", 400);
    await save(id, [{ index: "0", selected: "A" }], "s1", 400);
    await save(id, [{ index: 0, selected: "Z" }], "s1", 400);
    await save(id, [{ index: 0, selected: "AB" }], "s1", 400);
    await save(id, "A", "s1", 400);
    await save(id, [1, 2, 3, 4].map((index) => ({ index, selected: "A" })), "s1", 400);
    const [row] = await attemptsOf(id);
    assert.deepEqual(row.answers.map((a) => [a.index, a.selected]), [[0, "A"]]);
  });

  test("saving before starting is refused", async () => {
    await save(await room(), [{ index: 0, selected: "A" }], "s3", 400);
  });

  test("simultaneous saves of different questions all land", async () => {
    const id = await room();
    await start(id, "s3");
    const res = await Promise.all([0, 1, 2].map((index) => m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, "s3", { answers: [{ index, selected: "D" }] }), { params: { id } })));
    assert.ok(res.every((r) => r.status === 200));
    const [row] = await attemptsOf(id);
    assert.deepEqual(row.answers.map((a) => a.index).sort(), [0, 1, 2]);
  });
});

describe("the deadline", () => {
  test("after time is up, answers are refused and the attempt is scored from what was saved", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "D" }]);
    await backdate(id, "s1", 61 * MIN);
    await save(id, [{ index: 2, selected: "C" }], "s1", 400);
    const [row] = await attemptsOf(id);
    assert.ok(row.submittedAt, "scored on the first request after the deadline");
    assert.equal(row.score, 3); // A right (+4), D wrong (-1), question 3 never saved
    assert.deepEqual(row.answers.map((a) => a.selected), ["A", "D", null]);
    // The end is the deadline, not the moment the app came back.
    assert.equal(new Date(row.submittedAt).getTime(), new Date(row.startedAt).getTime() + 60 * MIN);
  });

  test("the app opening a test whose time ran out gets the score, but no keys while the test is live", async () => {
    const id = await room();
    await start(id, "s2");
    await save(id, [{ index: 0, selected: "A" }], "s2");
    await backdate(id, "s2", 2 * HOUR);
    const body = await view(id, "s2");
    assert.equal(body.attempt.state, "submitted");
    assert.deepEqual(Object.keys(body.attempt.result), ["submittedAt"]);
    assert.equal((await attemptsOf(id))[0].score, 4);
    assert.ok(!/correctAnswer|explanation|Solution/.test(JSON.stringify(body.questions)));
    assert.ok(body.attempt.answers.every((a: { correct: unknown }) => a.correct === null));
  });
});

describe("submitting", () => {
  test("submitting twice returns the first result, and a late save can't change it", async () => {
    const id = await room();
    await start(id);
    const first = await submit(id, { answers: [{ index: 0, selected: "A" }, { index: 1, selected: "A" }] });
    assert.equal((await attemptsOf(id))[0].score, 3);
    const second = await submit(id, { answers: [{ index: 2, selected: "C" }] });
    assert.equal(second.attempt.result.submittedAt, first.attempt.result.submittedAt);
    await save(id, [{ index: 2, selected: "C" }], "s1", 400);
    const [row] = await attemptsOf(id);
    assert.equal(row.score, 3);
    assert.deepEqual(row.answers.map((a) => a.selected), ["A", "A", null]);
    // A submitted attempt can't be started again.
    const again = await start(id);
    assert.equal(again.attempt.state, "submitted");
    assert.equal(again.attempt.startedAt, first.attempt.startedAt);
  });

  test("simultaneous submits score once", async () => {
    const id = await room();
    await start(id, "s2");
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "B" }, { index: 2, selected: "D" }], "s2");
    const res = await Promise.all(Array.from({ length: 4 }, () => m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, "s2", {}), { params: { id } })));
    const bodies = await Promise.all(res.map((r) => r.json()));
    assert.ok(res.every((r) => r.status === 200));
    assert.equal(new Set(bodies.map((b) => b.attempt.result.submittedAt)).size, 1);
    assert.equal((await attemptsOf(id))[0].score, 7); // 4 + 4 - 1
  });

  test("invalid answers sent with a submit are refused rather than dropped", async () => {
    const id = await room();
    await start(id, "s3");
    await submit(id, { answers: [{ index: 9, selected: "A" }] }, "s3", 400);
    const [row] = await attemptsOf(id);
    assert.equal(row.submittedAt, null);
  });
});

describe("finalize under concurrent saves", () => {
  test("stale finalization and concurrent saving count every committed answer", async () => {
    const id = await room();
    await start(id);
    await save(id, [{ index: 0, selected: "B" }]);
    const attempt = (await m.TestAttempt.findOne({ testId: id }))!;
    const testDoc = (await m.TestRoom.findById(id))!;
    const { finalize } = await import("@/lib/attempts");
    // Finalize was handed a stale document. All saves committed before its
    // transaction must be counted; a save racing after submission is refused.
    await save(id, [{ index: 0, selected: "A" }]);
    const replies = await Promise.all([
      finalize(testDoc, attempt),
      m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, "s1", { answers: [{ index: 0, selected: "D" }] }), { params: { id } }),
    ]);
    const row = (await attemptsOf(id))[0];
    assert.ok(row.submittedAt);
    if (replies[1].status === 200) { assert.equal(row.answers[0].selected, "D"); assert.equal(row.score, -1); }
    else { assert.equal(replies[1].status, 400); assert.equal(row.answers[0].selected, "A"); assert.equal(row.score, 4); }
  });
});

describe("Close Now", () => {
  test("scores students mid-test with their saved answers and keeps finished results", async () => {
    const id = await room();
    await start(id, "s1");
    await start(id, "s2");
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "C" }], "s2");
    const done = await submit(id, { answers: [{ index: 0, selected: "A" }, { index: 1, selected: "B" }, { index: 2, selected: "C" }] }, "s1");
    assert.equal((await attemptsOf(id)).find((r) => String(r.studentId) === ids.s1)!.score, 12);
    const submittedAt = done.attempt.result.submittedAt;

    const closed = await closeNow(id);
    assert.equal(closed.test.status, "closed");
    const rows = await attemptsOf(id);
    assert.ok(rows.every((r) => r.submittedAt), "no attempt is left running");
    const s1 = rows.find((r) => String(r.studentId) === ids.s1)!;
    const s2 = rows.find((r) => String(r.studentId) === ids.s2)!;
    assert.equal(s1.score, 12);
    assert.equal(new Date(s1.submittedAt!).toISOString(), submittedAt);
    assert.equal(s2.score, 3); // A right, C wrong
    assert.deepEqual(s2.answers.map((a) => a.selected), ["A", "C", null]);
  });

  test("afterwards nobody can start or write answers", async () => {
    const id = await room();
    await start(id, "s1");
    await closeNow(id);
    await start(id, "s3", 400);
    await save(id, [{ index: 0, selected: "A" }], "s1", 400);
    await closeNow(id, 400); // already closed
  });

  test("only the teacher (or tuition) may close it", async () => {
    const id = await room();
    await json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "s1", { closeNow: true }), { params: { id } }), 403);
  });

  test("the results list scores attempts whose time ran out unnoticed", async () => {
    const id = await room();
    await start(id, "s3");
    await backdate(id, "s3", 2 * HOUR);
    const body = await view(id, "teacher");
    assert.deepEqual(body.results, []); // Phase 1: results stay hidden until genuine completion.
    assert.ok((await attemptsOf(id)).find(a => String(a.studentId) === ids.s3)?.submittedAt);
  });
});

describe("who can see what", () => {
  test("a student from another batch or institute can't start or save", async () => {
    const id = await room();
    await start(id, "s4", 404);
    await start(id, "s5", 404);
    await save(id, [{ index: 0, selected: "A" }], "s4", 404);
    await submit(id, {}, "s5", 404);
    assert.equal((await attemptsOf(id)).length, 0);
  });

  test("a teacher can't start, save or submit as a student", async () => {
    const id = await room();
    await start(id, "teacher", 403);
    await save(id, [], "teacher", 403);
    await submit(id, {}, "teacher", 403);
  });

  test("a student only ever gets their own attempt", async () => {
    const id = await room();
    await start(id, "s1");
    await save(id, [{ index: 0, selected: "A" }], "s1");
    await start(id, "s2");
    const s2 = await view(id, "s2");
    assert.deepEqual(s2.attempt.answers, []);
    assert.equal(s2.results, undefined);
  });

  test("no answer key or solution leaks while the attempt is running", async () => {
    const id = await room();
    const started = await start(id);
    await save(id, [{ index: 0, selected: "A" }]);
    for (const body of [started, await view(id, "s1")]) {
      const text = JSON.stringify(body);
      assert.ok(!/correctAnswer|explanation|Solution/.test(text), "no key or solution before submitting");
      assert.ok(body.attempt.answers.every((a: { correct: unknown }) => a.correct === null));
    }
    // Submitting while the test is live releases nothing but the score.
    const done = await submit(id);
    assert.equal(done.attempt.state, "submitted");
    assert.deepEqual(done.attempt.answers.map((a: { selected: string | null }) => a.selected), ["A", null, null]);
    for (const body of [done, await view(id, "s1"), await start(id)]) {
      assert.deepEqual(Object.keys(body.attempt.result), ["submittedAt"], "no score, counts or time before the test closes");
    }
    assert.ok(!/correctAnswer|explanation|Solution/.test(JSON.stringify(done.questions)));
    assert.ok(done.attempt.answers.every((a: { correct: unknown }) => a.correct === null));
    assert.ok(!/correctAnswer|explanation|Solution/.test(JSON.stringify(await view(id, "s1"))));
    assert.ok(!/correctAnswer|explanation|Solution/.test(JSON.stringify(await start(id))));
  });

  test("the test list and the dashboard show no marks until the test closes", async () => {
    const id = await room();
    await start(id, "s3");
    await submit(id, { answers: [{ index: 0, selected: "A" }] }, "s3");
    const mine = async () => (await json(await m.listRoute.GET(req("GET", "/api/tests", "s3"), {}), 200)).tests.find((t: { id: string }) => t.id === id).mine;
    const last = async () => (await json(await m.overviewRoute.GET(req("GET", "/api/student/overview", "s3"), {}), 200)).insight.lastResult;
    assert.deepEqual(await mine(), { state: "submitted", score: null });
    assert.equal(await last(), null);
    await closeNow(id);
    assert.deepEqual(await mine(), { state: "submitted", score: 4 });
    assert.equal((await last()).score, 4);
  });

  test("once the test closes, the same student gets answers, correctness and solutions", async () => {
    const id = await room();
    await start(id);
    await submit(id, { answers: [{ index: 0, selected: "A" }, { index: 1, selected: "D" }] });
    await closeNow(id);
    for (const body of [await view(id, "s1"), await start(id)]) {
      assert.equal(body.attempt.result.score, 3); // +4 right, −1 wrong
      assert.equal(body.attempt.result.correct, 1);
      assert.equal(body.attempt.result.wrong, 1);
      assert.equal(body.questions[0].correctAnswer, "A");
      assert.equal(body.questions[0].explanation, "Solution One");
      assert.deepEqual(body.attempt.answers.map((a: { correct: boolean | null }) => a.correct), [true, false, null]);
    }
    // A student who never started also sees the answers after closing, and another batch still can't.
    const closedView = await view(id, "s2");
    assert.equal(closedView.questions[0].correctAnswer, "A");
    await view(id, "s4", 404);
  });

  test("the question bank was never changed by any of this", async () => {
    assert.equal(await bank(), bankDigest);
  });
});
