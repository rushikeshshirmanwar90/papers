// UX-1: students can see upcoming (scheduled) tests in their list when the app
// asks for them, without getting any way to open or start them early. Runs
// the real route handlers against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [listRoute, testRoute, startRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/route"),
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    listRoute,
    testRoute,
    startRoute,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seed() {
  const { Tuition, User, Batch, TestRoom, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const user = (email: string, role: string) => User.create({ email, name: email, passwordHash: "x", role, tuitionId: tuition._id, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const student = await user("student@test.local", "student");
  const otherStudent = await user("other@test.local", "student");
  tokens.teacher = await auth.signToken(teacher);
  tokens.student = await auth.signToken(student);
  tokens.otherStudent = await auth.signToken(otherStudent);

  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const otherBatch = await Batch.create({ tuitionId: tuition._id, name: "12 NEET", track: "NEET", subjects: ["Physics"], teachers: [] });
  await User.updateOne({ _id: student._id }, { batchId: batch._id });
  await User.updateOne({ _id: otherStudent._id }, { batchId: otherBatch._id });

  const question = { subject: "Physics", questionText: "Secret question", optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer: "A", explanation: "Secret solution" };
  const room = (title: string, opensAt: Date, batchId = batch._id) =>
    TestRoom.create({ tuitionId: tuition._id, batchId, teacherId: teacher._id, title, durationMinutes: 30, opensAt, questions: [question] });

  const open = await room("Open test", new Date(Date.now() - 60_000));
  const scheduled = await room("Scheduled test", new Date(Date.now() + 2 * 86_400_000));
  await room("Other batch's scheduled test", new Date(Date.now() + 86_400_000), otherBatch._id);
  ids.open = String(open._id);
  ids.scheduled = String(scheduled._id);
}

async function request(method: string, path: string, who: keyof typeof tokens) {
  return new NextRequest(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${tokens[who]}` } });
}

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const list = async (who: keyof typeof tokens, query = "") => (await json(await m.listRoute.GET(await request("GET", `/api/tests${query}`, who), {}), 200)).tests as { id: string; title: string; status: string; mine?: unknown }[];

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "ux1_student_tests";
  process.env.JWT_SECRET = "ux1-test-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("GET /api/tests for students", () => {
  test("without ?upcoming=1 the list is unchanged: open tests only (older app versions)", async () => {
    const tests = await list("student");
    assert.deepEqual(tests.map((t) => t.title), ["Open test"]);
  });

  test("with ?upcoming=1 scheduled tests of the student's own batch are listed as scheduled", async () => {
    const tests = await list("student", "?upcoming=1");
    assert.deepEqual(tests.map((t) => t.title).sort(), ["Open test", "Scheduled test"]);
    const scheduled = tests.find((t) => t.id === ids.scheduled)!;
    assert.equal(scheduled.status, "scheduled");
    assert.equal(scheduled.mine, null);
  });

  test("the list never carries questions, answers or solutions", async () => {
    const raw = JSON.stringify(await list("student", "?upcoming=1"));
    assert.ok(!raw.includes("Secret question"));
    assert.ok(!raw.includes("Secret solution"));
  });

  test("another batch's scheduled tests stay hidden", async () => {
    const tests = await list("otherStudent", "?upcoming=1");
    assert.deepEqual(tests.map((t) => t.title), ["Other batch's scheduled test"]);
  });

  test("a scheduled test still can't be opened (404) or started (400) early", async () => {
    const id = ids.scheduled;
    await json(await m.testRoute.GET(await request("GET", `/api/tests/${id}`, "student"), { params: { id } }), 404);
    await json(await m.startRoute.POST(await request("POST", `/api/tests/${id}/start`, "student"), { params: { id } }), 400);
  });

  test("teachers' lists are unaffected by the flag", async () => {
    const plain = await list("teacher");
    const flagged = await list("teacher", "?upcoming=1");
    assert.deepEqual(flagged.map((t) => t.id).sort(), plain.map((t) => t.id).sort());
  });
});
