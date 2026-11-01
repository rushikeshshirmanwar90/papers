// Phase 2C: live test monitoring, server side — eligible students, the five states,
// answered counts, deadline handling, isolation and Close Now. Runs the real route
// handlers against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const MIN = 60_000;
const HOUR = 60 * MIN;

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [testRoute, monitorRoute, startRoute, answersRoute, submitRoute, eventsRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/monitor/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/answers/route"),
    import("@/app/api/tests/[id]/submit/route"),
    import("@/app/api/tests/[id]/events/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    testRoute,
    monitorRoute,
    startRoute,
    answersRoute,
    submitRoute,
    eventsRoute,
    auth,
    db,
    monitor: await import("@/lib/test-monitor"),
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
  const user = (email: string, role: string | null, t: { _id: unknown } | null = tuition) =>
    User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: t?._id ?? null, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const outsider = await user("outsider@test.local", "teacher"); // same tuition, not in the batch
  const strange = await user("strange@test.local", "teacher", other); // another tuition
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const batch2 = await Batch.create({ tuitionId: tuition._id, name: "12 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const otherBatch = await Batch.create({ tuitionId: other._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [] });
  for (const [key, batchDoc, t] of [
    ["s1", batch, tuition],
    ["s2", batch, tuition],
    ["s3", batch, tuition],
    ["s4", batch2, tuition], // another batch of the same tuition
    ["s5", otherBatch, other], // another tuition
  ] as const) {
    const u = await user(`${key}@test.local`, "student", t);
    await User.updateOne({ _id: u._id }, { batchId: batchDoc._id });
    tokens[key] = await auth.signToken((await User.findById(u._id))!);
    ids[key] = String(u._id);
  }
  // Not students of the batch: a teacher carrying the batch id, and someone whose request is still pending (no role, no tuition, no batch).
  const strayTeacher = await user("stray@test.local", "teacher");
  await User.updateOne({ _id: strayTeacher._id }, { batchId: batch._id });
  await user("pending@test.local", null, null);
  // A turned-off student of the batch who never started.
  const off = await user("off@test.local", "student");
  await User.updateOne({ _id: off._id }, { batchId: batch._id, active: false });

  tokens.teacher = await auth.signToken(teacher);
  tokens.outsider = await auth.signToken(outsider);
  tokens.strange = await auth.signToken(strange);
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
async function room(over: { opensAt?: Date; closesAt?: Date; durationMinutes?: number } = {}) {
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
    batchId: ids.batch,
    teacherId: ids.teacher,
    title: "Monitor test",
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

function req(method: string, path: string, who?: string, body?: unknown) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

type Row = { student: { id: string; name: string }; state: string; answered: number; total: number; startedAt: string | null; submittedAt: string | null; remainingSeconds: number | null };
type Monitor = { status: string; serverTime: string; counts: Record<string, number>; students: Row[] };

const watch = async (id: string, who = "teacher", status = 200): Promise<Monitor> => json(await m.monitorRoute.GET(req("GET", `/api/tests/${id}/monitor`, who), { params: { id } }), status);
const startNow = async (id: string, who: string) => json(await m.startRoute.POST(req("POST", `/api/tests/${id}/start`, who), { params: { id } }), 200);
const save = async (id: string, answers: unknown, who: string) => json(await m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, who, { answers }), { params: { id } }), 200);
const submit = async (id: string, who: string) => json(await m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, who, {}), { params: { id } }), 200);
const away = async (id: string, awayMs: number, who: string) => json(await m.eventsRoute.POST(req("POST", `/api/tests/${id}/events`, who, { type: "away", awayMs }), { params: { id } }), 200);
const closeNow = async (id: string) => json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), { params: { id } }), 200);
const backdate = (id: string, who: string, ms: number) => m.TestAttempt.updateOne({ testId: id, studentId: ids[who] }, { startedAt: new Date(Date.now() - ms) });
const rowOf = (mon: Monitor, who: string) => mon.students.find((r) => r.student.id === ids[who])!;

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase2c_live_monitor";
  process.env.JWT_SECRET = "phase2c-test-jwt-secret-0123456789abcdef";
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

describe("monitor: who is counted", () => {
  test("only approved, active students of the test's batch are eligible; nobody has started", async () => {
    const id = await room();
    const mon = await watch(id);
    assert.equal(mon.status, "open");
    assert.deepEqual(mon.counts, { total: 3, notStarted: 3, inProgress: 0, submitted: 0, autoSubmitted: 0, violations: 0 });
    assert.deepEqual(mon.students.map((r) => r.student.id).sort(), [ids.s1, ids.s2, ids.s3].sort());
    assert.ok(mon.students.every((r) => r.state === "not-started" && r.answered === 0 && r.total === 3 && r.startedAt === null && r.remainingSeconds === null));
  });

  test("a student turned off after submitting stays counted", async () => {
    const id = await room();
    await startNow(id, "s1");
    await m.User.updateOne({ _id: ids.s1 }, { active: false });
    try {
      assert.equal((await watch(id)).counts.total, 3);
    } finally {
      await m.User.updateOne({ _id: ids.s1 }, { active: true });
    }
  });
});

describe("monitor: batch transfers and isolation", () => {
  test("a student moved to another batch after taking the test is still counted; one who never started is not", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }], "s1");
    await submit(id, "s1");
    const batch2 = (await m.User.findById(ids.s4))!.batchId;
    await m.User.updateOne({ _id: ids.s1 }, { batchId: batch2 });
    await m.User.updateOne({ _id: ids.s2 }, { batchId: batch2 }); // never started
    try {
      const mon = await watch(id);
      assert.deepEqual(mon.counts, { total: 2, notStarted: 1, inProgress: 0, submitted: 1, autoSubmitted: 0, violations: 0 });
      assert.deepEqual(mon.students.map((r) => r.student.id).sort(), [ids.s1, ids.s3].sort());
      assert.equal(rowOf(mon, "s1").state, "submitted");
    } finally {
      await m.User.updateMany({ _id: { $in: [ids.s1, ids.s2] } }, { batchId: ids.batch });
    }
  });

  test("an attempt carrying another institute's id is never counted", async () => {
    const id = await room();
    const other = (await m.User.findById(ids.s5))!;
    await m.TestAttempt.create({ tuitionId: other.tuitionId, testId: id, batchId: other.batchId, studentId: ids.s5, startedAt: new Date(), answers: [] });
    const mon = await watch(id);
    assert.equal(mon.counts.inProgress, 0);
    assert.ok(!JSON.stringify(mon).includes(ids.s5));
  });
});

describe("monitor: inconsistent attempts", () => {
  test("a forged attempt with the wrong tuition or batch cannot change an eligible student's status", async () => {
    const id = await room();
    const other = (await m.User.findById(ids.s5))!;
    const batch2 = (await m.User.findById(ids.s4))!.batchId;
    const forged = { testId: id, startedAt: new Date(Date.now() - 2 * HOUR), submittedAt: new Date(), answers: [{ index: 0, selected: "A", correct: null }] };
    await m.TestAttempt.collection.insertMany([
      { ...forged, studentId: new (await import("mongoose")).Types.ObjectId(ids.s2), tuitionId: other.tuitionId, batchId: other.batchId },
      { ...forged, studentId: new (await import("mongoose")).Types.ObjectId(ids.s3), tuitionId: new (await import("mongoose")).Types.ObjectId(ids.tuition), batchId: batch2 },
    ]);
    const mon = await watch(id);
    assert.deepEqual(mon.counts, { total: 3, notStarted: 3, inProgress: 0, submitted: 0, autoSubmitted: 0, violations: 0 });
  });
});

describe("monitor: polling does not rewrite finished attempts", () => {
  test("repeated reads leave finalized attempts exactly as they were, and expired ones are finalized once", async () => {
    const id = await room({ durationMinutes: 30 });
    await startNow(id, "s1");
    await submit(id, "s1");
    await startNow(id, "s2");
    await save(id, [{ index: 0, selected: "A" }], "s2");
    await backdate(id, "s2", 2 * HOUR);
    await startNow(id, "s3");
    await away(id, 60_000, "s3");
    const dump = async () => JSON.stringify(await m.TestAttempt.find({ testId: id }).sort({ studentId: 1 }).lean());
    const first = await watch(id);
    assert.deepEqual([first.counts.submitted, first.counts.autoSubmitted, first.counts.violations, first.counts.inProgress], [3, 1, 1, 0]);
    const after = await dump();
    await Promise.all([watch(id), watch(id)]);
    await watch(id);
    assert.equal(await dump(), after);
  });
});

describe("monitor: states and progress", () => {
  test("in progress, submitted, violation and not started are told apart, and the counts add up", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "D" }], "s1");
    await startNow(id, "s2");
    await save(id, [{ index: 0, selected: "B" }], "s2");
    await submit(id, "s2");
    // s3 never starts.
    const mon = await watch(id);
    assert.deepEqual(mon.counts, { total: 3, notStarted: 1, inProgress: 1, submitted: 1, autoSubmitted: 0, violations: 0 });
    assert.equal(mon.counts.total, mon.counts.notStarted + mon.counts.inProgress + mon.counts.submitted);
    const r1 = rowOf(mon, "s1");
    assert.equal(r1.state, "in-progress");
    assert.equal(r1.answered, 2); // saved answers, whatever they are
    assert.ok(r1.startedAt);
    assert.equal(r1.submittedAt, null);
    assert.ok(r1.remainingSeconds! > 59 * 60 - 5 && r1.remainingSeconds! <= 60 * 60);
    const r2 = rowOf(mon, "s2");
    assert.equal(r2.state, "submitted");
    assert.equal(r2.answered, 1);
    assert.ok(r2.submittedAt);
    assert.equal(r2.remainingSeconds, null);
    assert.equal(rowOf(mon, "s3").state, "not-started");
  });

  test("a violation is shown as such and counts as finalized", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 2, selected: "C" }], "s1");
    await away(id, 3000, "s1"); // a short interruption changes nothing
    assert.equal(rowOf(await watch(id), "s1").state, "in-progress");
    await away(id, 60_000, "s1");
    const mon = await watch(id);
    const row = rowOf(mon, "s1");
    assert.equal(row.state, "violation");
    assert.equal(row.answered, 1);
    assert.ok(row.submittedAt);
    assert.equal(mon.counts.violations, 1);
    assert.equal(mon.counts.submitted, 1);
    assert.equal(mon.counts.inProgress, 0);
  });

  test("clearing an answer lowers the answered count", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "B" }], "s1");
    await save(id, [{ index: 1, selected: null }], "s1");
    assert.equal(rowOf(await watch(id), "s1").answered, 1);
  });
});

describe("monitor: deadlines", () => {
  test("an attempt whose time limit has passed is auto-submitted, not in progress, and is scored with what was saved", async () => {
    const id = await room({ durationMinutes: 30 });
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }], "s1");
    await startNow(id, "s2");
    await save(id, [{ index: 0, selected: "A" }], "s2");
    await submit(id, "s2");
    await backdate(id, "s1", 2 * HOUR);
    const mon = await watch(id);
    const row = rowOf(mon, "s1");
    assert.equal(row.state, "auto-submitted");
    assert.equal(row.answered, 1);
    assert.equal(row.remainingSeconds, null);
    assert.equal(mon.counts.inProgress, 0);
    assert.equal(mon.counts.autoSubmitted, 1);
    assert.equal(mon.counts.submitted, 2); // auto-submitted counts as submitted
    assert.equal(rowOf(mon, "s2").state, "submitted"); // the student's own submit is not an auto-submit
    // The stored attempt was scored, with the answer saved before time ran out.
    const stored = await m.TestAttempt.findOne({ testId: id, studentId: ids.s1 }).lean<{ submittedAt: Date | null; score: number }>();
    assert.ok(stored!.submittedAt);
    assert.equal(stored!.score, 4);
    // And it stays that way on the next look.
    assert.equal(rowOf(await watch(id), "s1").state, "auto-submitted");
  });

  test("the remaining time follows the test's closing time when that comes first", async () => {
    const id = await room({ durationMinutes: 60 });
    await startNow(id, "s1");
    await m.TestRoom.updateOne({ _id: id }, { closesAt: new Date(Date.now() + 10 * MIN) });
    const left = rowOf(await watch(id), "s1").remainingSeconds!;
    assert.ok(left > 9 * 60 - 5 && left <= 10 * 60, `expected about 10 minutes, got ${left}s`);
  });

  test("an upcoming test can be looked at: nobody has started", async () => {
    const id = await room({ opensAt: new Date(Date.now() + HOUR), closesAt: new Date(Date.now() + 4 * HOUR) });
    const mon = await watch(id);
    assert.equal(mon.status, "scheduled");
    assert.equal(mon.counts.notStarted, 3);
  });
});

describe("monitor: Close Now", () => {
  test("closing finalizes active attempts, keeps their answers, and the monitor shows it", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }, { index: 1, selected: "B" }], "s1");
    await startNow(id, "s2");
    await save(id, [{ index: 2, selected: "C" }], "s2");
    await submit(id, "s2");
    assert.equal((await watch(id)).counts.inProgress, 1);
    await closeNow(id);
    const mon = await watch(id);
    assert.equal(mon.status, "closed");
    assert.deepEqual(mon.counts, { total: 3, notStarted: 1, inProgress: 0, submitted: 2, autoSubmitted: 1, violations: 0 });
    assert.equal(rowOf(mon, "s1").state, "auto-submitted");
    assert.equal(rowOf(mon, "s1").answered, 2);
    assert.equal(rowOf(mon, "s2").state, "submitted");
    // The teacher's results list agrees.
    const detail = await json(await m.testRoute.GET(req("GET", `/api/tests/${id}`, "teacher"), { params: { id } }), 200);
    const byId = new Map(detail.results.map((r: { student: { id: string }; state: string; score: number | null }) => [r.student.id, r]));
    assert.equal((byId.get(ids.s1) as { state: string; score: number }).state, "submitted");
    assert.equal((byId.get(ids.s1) as { score: number }).score, 8);
    assert.equal((byId.get(ids.s2) as { score: number }).score, 4);
    assert.equal((byId.get(ids.s3) as { state: string }).state, "not-started");
  });
});

describe("monitor: access", () => {
  test("students, other tuitions, teachers outside the batch and anonymous callers are refused", async () => {
    const id = await room();
    await watch(id, "s1", 403);
    await watch(id, "s5", 403);
    await watch(id, "strange", 404); // another institute: the test is not found
    await watch(id, "outsider", 404); // same tuition, not teaching this batch
    await json(await m.monitorRoute.GET(req("GET", `/api/tests/${id}/monitor`), { params: { id } }), 401);
    await json(await m.monitorRoute.GET(req("GET", `/api/tests/not-an-id/monitor`, "teacher"), { params: { id: "not-an-id" } }), 404);
  });

  test("the response holds no questions, answer keys, explanations or marks, and no other institute's students", async () => {
    const id = await room();
    await startNow(id, "s1");
    await save(id, [{ index: 0, selected: "A" }], "s1");
    await submit(id, "s1");
    const mon = await watch(id);
    const text = JSON.stringify(mon);
    for (const leak of ["correctAnswer", "explanation", "Solution", "questionText", "optionA", "score", "selected", "correct"]) assert.ok(!text.includes(leak), `response mentions ${leak}`);
    assert.ok(!text.includes(ids.s4) && !text.includes(ids.s5));
    assert.deepEqual(Object.keys(mon).sort(), ["counts", "serverTime", "status", "students"]);
  });
});

describe("monitor: state rules", () => {
  test("stateOf and buildMonitor classify from the data alone", () => {
    const test = { durationMinutes: 30, closesAt: new Date(Date.UTC(2026, 0, 1, 12, 0)), questions: [1, 2, 3, 4] };
    const t0 = Date.UTC(2026, 0, 1, 10, 0);
    const attempt = (over: Record<string, unknown> = {}) => ({ startedAt: new Date(t0), submittedAt: null, endedReason: null, ...over }) as Parameters<typeof m.monitor.stateOf>[1];
    assert.equal(m.monitor.stateOf(test, undefined, t0), "not-started");
    assert.equal(m.monitor.stateOf(test, attempt(), t0 + 10 * MIN), "in-progress");
    assert.equal(m.monitor.stateOf(test, attempt(), t0 + 30 * MIN), "auto-submitted");
    assert.equal(m.monitor.stateOf(test, attempt({ submittedAt: new Date(t0 + 10 * MIN) }), t0 + HOUR), "submitted");
    assert.equal(m.monitor.stateOf(test, attempt({ submittedAt: new Date(t0 + 30 * MIN) }), t0 + HOUR), "auto-submitted");
    assert.equal(m.monitor.stateOf(test, attempt({ submittedAt: new Date(t0 + 5 * MIN), endedReason: "violation" }), t0 + HOUR), "violation");
    // A test closing before the time limit ends it earlier.
    const closing = { ...test, closesAt: new Date(t0 + 20 * MIN) };
    assert.equal(m.monitor.stateOf(closing, attempt(), t0 + 20 * MIN), "auto-submitted");

    const students = [{ _id: "a", name: "Asha" }, { _id: "b", name: "Bala" }] as unknown as Parameters<typeof m.monitor.buildMonitor>[1];
    const attempts = [{ studentId: "a", startedAt: new Date(t0), submittedAt: null, endedReason: null, answered: 9 }] as unknown as Parameters<typeof m.monitor.buildMonitor>[2];
    const { counts, rows } = m.monitor.buildMonitor(test, students, attempts, t0 + 5 * MIN);
    assert.equal(rows[0].answered, 4); // never more than the questions
    assert.equal(rows[0].remainingSeconds, 25 * 60);
    assert.deepEqual(counts, { total: 2, notStarted: 1, inProgress: 1, submitted: 0, autoSubmitted: 0, violations: 0 });
  });
});

describe("question bank", () => {
  test("monitoring left the question bank untouched", async () => {
    assert.equal(await bank(), bankDigest);
  });
});
