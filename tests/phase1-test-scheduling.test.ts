// Phase 1: setting, scheduling, editing and cancelling tests. Runs the real
// route handlers against a throwaway in-memory MongoDB.
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
  const [listRoute, testRoute, startRoute, submitRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/route"),
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/submit/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    listRoute,
    testRoute,
    startRoute,
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

/** A fingerprint of every question in the bank: it must not change. */
async function bank() {
  const docs = await m.Question.collection.find({}).sort({ _id: 1 }).toArray();
  return `${docs.length}:${createHash("sha256").update(JSON.stringify(docs)).digest("hex")}`;
}

async function seed() {
  const { Tuition, User, Batch, Question, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const user = (email: string, role: string) => User.create({ email, name: email, passwordHash: "x", role, tuitionId: tuition._id, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const otherTeacher = await user("other-teacher@test.local", "teacher");
  const student = await user("student@test.local", "student");
  tokens.teacher = await auth.signToken(teacher);
  tokens.otherTeacher = await auth.signToken(otherTeacher);
  tokens.student = await auth.signToken(student);

  const batch = await Batch.create({
    tuitionId: tuition._id,
    name: "11 JEE",
    track: "JEE",
    subjects: ["Physics", "Chemistry"],
    teachers: [{ teacherId: teacher._id, subject: "Physics" }, { teacherId: otherTeacher._id, subject: "Chemistry" }],
  });
  await User.updateOne({ _id: student._id }, { batchId: batch._id });
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);

  const docs = await Question.insertMany(
    ["One", "Two", "Three"].map((word, i) => ({
      paperId: tuition._id, // any id: the in-memory bank has no papers
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
      correctAnswer: "ABCD"[i],
      explanation: `Solution ${word}`,
    }))
  );
  ids.q0 = String(docs[0]._id);
  ids.q1 = String(docs[1]._id);
  ids.q2 = String(docs[2]._id);
  bankDigest = await bank();
}

const question = (id: string, word: string) => ({
  _id: id,
  subject: "Physics",
  questionText: `Question ${word}`,
  optionA: "1",
  optionB: "2",
  optionC: "3",
  optionD: "4",
  correctAnswer: "A",
  explanation: `Solution ${word}`,
});

const setup = (over: Record<string, unknown> = {}) => ({
  batchId: ids.batch,
  title: "Weekly test",
  subject: "Physics",
  durationMinutes: 60,
  marksPerQuestion: 4,
  negativeMarks: 1,
  questions: [question(ids.q0, "One"), question(ids.q1, "Two")],
  ...over,
});

function req(method: string, path: string, who: keyof typeof tokens, body?: unknown) {
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

const create = async (body: Record<string, unknown>, status = 200, who: keyof typeof tokens = "teacher") =>
  json(await m.listRoute.POST(req("POST", "/api/tests", who, body), {}), status);
const patch = async (id: string, body: Record<string, unknown>, status = 200, who: keyof typeof tokens = "teacher") =>
  json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, who, body), { params: { id } }), status);
const cancel = async (id: string, status = 200, who: keyof typeof tokens = "teacher") =>
  json(await m.testRoute.DELETE(req("DELETE", `/api/tests/${id}`, who), { params: { id } }), status);
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase1_test_scheduling";
  process.env.JWT_SECRET = "phase1-test-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("setting a test", () => {
  test("Start Now opens it at the server's clock, whatever the phone says", async () => {
    const before = Date.now();
    const { test } = await create(setup({ startNow: true, opensAt: iso(-5 * HOUR), closesAt: iso(3 * HOUR) }));
    const opened = new Date(test.opensAt).getTime();
    assert.ok(opened >= before - 1000 && opened <= Date.now() + 1000, "opensAt is the server's now");
    assert.equal(test.status, "open");
    assert.equal(test.questionCount, 2);
    assert.equal(test.maxScore, 8);
    assert.equal(test.negativeMarks, 1);
  });

  test("a future test is scheduled, with its last permitted start", async () => {
    const opens = Date.now() + 24 * HOUR;
    const { test } = await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 3 * HOUR).toISOString() }));
    assert.equal(test.status, "scheduled");
    assert.equal(new Date(test.lastStartAt).getTime(), opens + 2 * HOUR);
  });

  test("a start time in the past is refused", async () => {
    await create(setup({ opensAt: iso(-MIN), closesAt: iso(2 * HOUR) }), 400);
    await create(setup({ opensAt: iso(-3 * HOUR), closesAt: iso(2 * HOUR) }), 400);
  });

  test("a test needs an opening (or startNow) and a closing time", async () => {
    await create(setup({ closesAt: iso(2 * HOUR) }), 400);
    await create(setup({ startNow: true }), 400);
  });

  test("closing at or before opening is refused", async () => {
    const opens = Date.now() + HOUR;
    await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens).toISOString() }), 400);
    await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens - HOUR).toISOString() }), 400);
    await create(setup({ startNow: true, closesAt: iso(-HOUR) }), 400);
  });

  test("the window must fit the whole time limit", async () => {
    const opens = Date.now() + HOUR;
    const short = await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 30 * MIN).toISOString() }), 400);
    assert.match(short.error ?? short.message ?? JSON.stringify(short), /time limit/);
    // Exactly the time limit is enough: the only start is at opening time.
    await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + HOUR).toISOString() }));
    await create(setup({ startNow: true, closesAt: iso(30 * MIN) }), 400);
  });

  test("a window longer than six hours is fine (the batch-schedule limit doesn't apply)", async () => {
    const opens = Date.now() + HOUR;
    await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 72 * HOUR).toISOString() }));
  });

  test("marking: negative marks can't exceed the marks for a right answer", async () => {
    await create(setup({ startNow: true, closesAt: iso(3 * HOUR), marksPerQuestion: 2, negativeMarks: 3 }), 400);
  });

  test("a teacher may set a test for any subject of any batch of their tuition, never another tuition's", async () => {
    // Not teaching Chemistry here, but the batch has it: the picked Physics questions don't belong to it.
    await create(setup({ startNow: true, closesAt: iso(3 * HOUR), subject: "Chemistry" }), 400);
    await create(setup({ startNow: true, closesAt: iso(3 * HOUR), subject: "Biology" }), 400);
    await create(setup({ startNow: true, closesAt: iso(3 * HOUR) }), 200, "otherTeacher");
    await create(setup({ startNow: true, closesAt: iso(3 * HOUR) }), 403, "student");
    const stranger = await m.Tuition.create({ name: "Tuition B" });
    const foreign = await m.Batch.create({ tuitionId: stranger._id, name: "Foreign", track: "JEE", subjects: ["Physics"], teachers: [] });
    await create(setup({ batchId: String(foreign._id), startNow: true, closesAt: iso(3 * HOUR) }), 404);
    await create(setup({ batchIds: [ids.batch, String(foreign._id)], startNow: true, closesAt: iso(3 * HOUR) }), 404);
  });

  test("batches of different exams or classes can't share a test, and questions must belong to the exam", async () => {
    const tuitionId = (await m.Batch.findById(ids.batch))!.tuitionId;
    const neet = await m.Batch.create({ tuitionId, name: "NEET", track: "NEET", subjects: ["Physics"], teachers: [] });
    await create(setup({ batchIds: [ids.batch, String(neet._id)], startNow: true, closesAt: iso(3 * HOUR) }), 400);
    const twelfth = await m.Batch.create({ tuitionId, name: "12 JEE", track: "JEE", standard: "12th", subjects: ["Physics"], teachers: [] });
    await create(setup({ batchId: String(twelfth._id), startNow: true, closesAt: iso(3 * HOUR) }), 400); // 11th questions, 12th batch
  });

  test("a batch whose program has no question bank can't get a test", async () => {
    const other = await m.Batch.create({ tuitionId: (await m.Batch.findById(ids.batch))!.tuitionId, name: "HSC", program: "HSC_SCIENCE", track: "General", subjects: ["Physics"], teachers: [{ teacherId: ids.teacher, subject: "Physics" }] });
    await create(setup({ batchId: String(other._id), startNow: true, closesAt: iso(3 * HOUR) }), 400);
  });

  test("questions keep pointing at the originals in the bank, and the bank is untouched", async () => {
    const { test } = await create(setup({ startNow: true, closesAt: iso(3 * HOUR) }));
    const saved = await m.TestRoom.findById(test.id).lean<{ questions: { sourceId: unknown; questionText: string }[] }>();
    assert.deepEqual(saved!.questions.map((q) => String(q.sourceId)), [ids.q0, ids.q1]);
    assert.equal(await bank(), bankDigest);
  });
});

describe("editing an upcoming test", () => {
  const upcoming = async () => {
    const opens = Date.now() + 24 * HOUR;
    return (await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 3 * HOUR).toISOString() }))).test as { id: string };
  };

  test("title, questions, marking, time limit and schedule can change", async () => {
    const t = await upcoming();
    const opens = Date.now() + 48 * HOUR;
    const { test } = await patch(t.id, {
      title: "Renamed",
      questions: [question(ids.q2, "Three")],
      marksPerQuestion: 3,
      negativeMarks: 0,
      durationMinutes: 90,
      opensAt: new Date(opens).toISOString(),
      closesAt: new Date(opens + 5 * HOUR).toISOString(),
    });
    assert.equal(test.title, "Renamed");
    assert.equal(test.questionCount, 1);
    assert.equal(test.maxScore, 3);
    assert.equal(test.durationMinutes, 90);
    assert.equal(test.status, "scheduled");
    const saved = await m.TestRoom.findById(t.id).lean<{ questions: { sourceId: unknown }[] }>();
    assert.equal(String(saved!.questions[0].sourceId), ids.q2);
  });

  test("the same rules apply as when setting one", async () => {
    const t = await upcoming();
    await patch(t.id, { opensAt: iso(-HOUR) }, 400);
    await patch(t.id, { durationMinutes: 240 }, 400); // the 3-hour window can't fit it
    await patch(t.id, { closesAt: null }, 400);
    await patch(t.id, { questions: [] }, 400);
  });

  test("it can be published now instead", async () => {
    const t = await upcoming();
    const { test } = await patch(t.id, { startNow: true, closesAt: iso(4 * HOUR) });
    assert.equal(test.status, "open");
  });

  test("not once a student has started it", async () => {
    const t = await upcoming();
    await m.TestAttempt.create({ tuitionId: (await m.TestRoom.findById(t.id))!.tuitionId, testId: t.id, batchId: ids.batch, studentId: (await m.User.findOne({ role: "student" }))!._id, startedAt: new Date() });
    await patch(t.id, { title: "Sneaky" }, 400);
    await cancel(t.id, 400);
    assert.equal((await m.TestRoom.findById(t.id))!.title, "Weekly test");
  });

  test("only the teacher who set it can edit or cancel it", async () => {
    const t = await upcoming();
    await patch(t.id, { title: "Mine now" }, 403, "otherTeacher");
    await cancel(t.id, 403, "otherTeacher");
    await patch(t.id, { title: "Mine now" }, 403, "student");
    await cancel(t.id, 403, "student");
  });

  test("cancelling removes the test and leaves the question bank alone", async () => {
    const t = await upcoming();
    await cancel(t.id);
    assert.equal(await m.TestRoom.countDocuments({ _id: t.id }), 0);
    assert.equal(await bank(), bankDigest);
  });
});

describe("live and completed tests", () => {
  const live = async () => (await create(setup({ startNow: true, closesAt: iso(4 * HOUR) }))).test as { id: string };

  test("a live test can't be edited or cancelled, only closed now", async () => {
    const t = await live();
    await patch(t.id, { title: "Changed" }, 400);
    await patch(t.id, { questions: [question(ids.q2, "Three")] }, 400);
    await cancel(t.id, 400);
    const { test } = await patch(t.id, { closeNow: true });
    assert.equal(test.status, "closed");
  });

  test("a completed test can't be closed again, edited or cancelled", async () => {
    const t = await live();
    await patch(t.id, { closeNow: true });
    await patch(t.id, { closeNow: true }, 400);
    await patch(t.id, { title: "Changed" }, 400);
    await cancel(t.id, 400);
  });

  test("an upcoming test can't be 'closed now'", async () => {
    const opens = Date.now() + 24 * HOUR;
    const { test } = await create(setup({ opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + 3 * HOUR).toISOString() }));
    await patch(test.id, { closeNow: true }, 400);
  });

  test("the list counts students who started and who submitted", async () => {
    const t = await live();
    await json(await m.startRoute.POST(req("POST", `/api/tests/${t.id}/start`, "student"), { params: { id: t.id } }), 200);
    const list = (await json(await m.listRoute.GET(req("GET", "/api/tests", "teacher"), {}), 200)).tests as { id: string; started: number; submitted: number }[];
    const row = list.find((x) => x.id === t.id)!;
    assert.equal(row.started, 1);
    assert.equal(row.submitted, 0);
  });
});

describe("students and the last permitted start", () => {
  /** A test opened two hours ago that closes in `closesInMs`, made directly so its window can be tight. */
  async function withTuition(closesInMs: number, durationMinutes = 60) {
    const batch = await m.Batch.findById(ids.batch);
    const t = await m.TestRoom.create({
      tuitionId: batch!.tuitionId,
      batchId: ids.batch,
      teacherId: ids.teacher,
      title: "Window test",
      durationMinutes,
      opensAt: new Date(Date.now() - 2 * HOUR),
      closesAt: new Date(Date.now() + closesInMs),
      questions: [{ ...question(ids.q0, "One"), sourceId: ids.q0 }],
    });
    return String(t._id);
  }

  test("starting after closing time minus the time limit is refused", async () => {
    const id = await withTuition(30 * MIN);
    await json(await m.startRoute.POST(req("POST", `/api/tests/${id}/start`, "student"), { params: { id } }), 400);
  });

  test("starting at or before that moment works, and the student gets the full time limit", async () => {
    const id = await withTuition(61 * MIN);
    const body = await json(await m.startRoute.POST(req("POST", `/api/tests/${id}/start`, "student"), { params: { id } }), 200);
    const left = new Date(body.attempt.deadline).getTime() - Date.now();
    assert.ok(left > 59 * MIN, "the whole hour is left");
  });

  test("a student can start, submit and see a result on a test set through the new flow", async () => {
    const { test } = await create(setup({ startNow: true, closesAt: iso(4 * HOUR) }));
    const id = test.id as string;
    await json(await m.startRoute.POST(req("POST", `/api/tests/${id}/start`, "student"), { params: { id } }), 200);
    const done = await json(await m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, "student", { answers: [{ index: 0, selected: "A" }, { index: 1, selected: "D" }] }), { params: { id } }), 200);
    assert.equal(done.attempt.state, "submitted");
    // The test is still live, so only the confirmation shows; the marks are stored (+4 right, −1 wrong).
    assert.deepEqual(Object.keys(done.attempt.result), ["submittedAt"]);
    const stored = await m.TestAttempt.findOne({ testId: id }).lean<{ score: number; correctCount: number; wrongCount: number; maxScore: number }>();
    assert.deepEqual([stored?.correctCount, stored?.wrongCount, stored?.score, stored?.maxScore], [1, 1, 3, 8]);
  });

  test("the question bank was never changed by any of this", async () => {
    assert.equal(await bank(), bankDigest);
  });
});
