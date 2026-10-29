// Step 1 security tests for the legacy question-bank routes. They run the
// real route handlers against a throwaway in-memory MongoDB, never a real
// database. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { NextRequest } from "next/server";

const ADMIN_KEY = "step1-test-admin-key-0123456789";
const HOST = "localhost:3000";
const BASE = `http://${HOST}`;

let mongod: MongoMemoryServer;
// Loaded after the environment is set: lib/db.ts reads MONGODB_URI on import.
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [questionRoute, paperRoute, uploadRoute, meRoute, startRoute, auth, adminSession, db] = await Promise.all([
    import("@/app/api/questions/[id]/route"),
    import("@/app/api/papers/[id]/route"),
    import("@/app/api/papers/upload/route"),
    import("@/app/api/auth/me/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/lib/auth"),
    import("@/lib/admin-session"),
    import("@/lib/db"),
  ]);
  const models = {
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Paper: (await import("@/models/Paper")).default,
    Question: (await import("@/models/Question")).default,
    Attempt: (await import("@/models/Attempt")).default,
    PracticeAnswer: (await import("@/models/PracticeAnswer")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    StoredFile: (await import("@/models/StoredFile")).default,
  };
  return { questionRoute, paperRoute, uploadRoute, meRoute, startRoute, auth, adminSession, db, ...models };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seed() {
  const { Tuition, User, Batch, Paper, Question, Attempt, PracticeAnswer, TestRoom, StoredFile, auth } = m;
  const [tuitionA, tuitionB] = await Tuition.create([{ name: "Tuition A" }, { name: "Tuition B" }]);
  const user = (email: string, role: string | null, tuitionId: unknown) =>
    User.create({ email, name: email, passwordHash: "x", role, tuitionId, emailVerified: true });
  const ownerA = await user("owner-a@test.local", "tuition", tuitionA._id);
  const teacherA = await user("teacher-a@test.local", "teacher", tuitionA._id);
  const teacherB = await user("teacher-b@test.local", "teacher", tuitionB._id);
  const studentA = await user("student-a@test.local", "student", tuitionA._id);
  const loner = await user("loner@test.local", null, null);
  for (const [name, u] of Object.entries({ ownerA, teacherA, teacherB, studentA, loner })) tokens[name] = await auth.signToken(u);

  const batch = await Batch.create({ tuitionId: tuitionA._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacherA._id, subject: "Physics" }] });
  await User.updateOne({ _id: studentA._id }, { batchId: batch._id });

  const paper = (title: string) => Paper.create({ title, examType: "JEE", year: 2024, subjects: ["Physics"], pdfUrl: "/api/files/x" });
  const question = (paperId: unknown, n: number) =>
    Question.create({ paperId, questionNumber: n, subject: "Physics", questionText: `Q${n} original`, optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer: "A" });

  // Nobody has used this paper: it may be deleted.
  const unused = await paper("Unused paper");
  const unusedQ1 = await question(unused._id, 1);
  const unusedQ2 = await question(unused._id, 2);
  await StoredFile.create({ paperId: unused._id, kind: "pdf", filename: "u.pdf", contentType: "application/pdf", size: 1, data: Buffer.from("x") });

  // A student attempted this paper.
  const attempted = await paper("Attempted paper");
  const attemptedQ = await question(attempted._id, 1);
  await Attempt.create({ studentId: studentA._id, paperId: attempted._id, answers: [{ questionId: attemptedQ._id, selected: "A" }], score: 4, correctCount: 1, wrongCount: 0, skippedCount: 0, totalQuestions: 1 });
  await StoredFile.create({ paperId: attempted._id, kind: "pdf", filename: "a.pdf", contentType: "application/pdf", size: 1, data: Buffer.from("x") });

  // A student practised a question of this paper.
  const practised = await paper("Practised paper");
  const practisedQ = await question(practised._id, 1);
  await PracticeAnswer.create({ tuitionId: tuitionA._id, studentId: studentA._id, questionId: practisedQ._id, selected: "A", correct: true, answeredAt: new Date() });

  // A test copied a question of this paper.
  const tested = await paper("Tested paper");
  const testedQ = await question(tested._id, 1);
  const testRoom = await TestRoom.create({
    tuitionId: tuitionA._id,
    batchId: batch._id,
    teacherId: teacherA._id,
    title: "Unit test",
    durationMinutes: 30,
    opensAt: new Date(Date.now() - 60000),
    questions: [{ sourceId: testedQ._id, subject: "Physics", questionText: "Q1 original", optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer: "A" }],
  });

  Object.assign(ids, {
    unused: String(unused._id),
    unusedQ1: String(unusedQ1._id),
    unusedQ2: String(unusedQ2._id),
    attempted: String(attempted._id),
    attemptedQ: String(attemptedQ._id),
    practisedQ: String(practisedQ._id),
    practised: String(practised._id),
    testedQ: String(testedQ._id),
    testRoom: String(testRoom._id),
  });
}

// ─── Requests ──────────────────────────────────────────────────────────────

type Who = "anonymous" | "admin" | "adminCookie" | keyof typeof tokens | "badToken";

async function headersFor(who: Who): Promise<Record<string, string>> {
  if (who === "anonymous") return {};
  if (who === "admin") return { "x-admin-key": ADMIN_KEY };
  if (who === "adminCookie") {
    return { cookie: `${m.adminSession.ADMIN_COOKIE}=${await m.adminSession.signAdminSession()}`, origin: BASE, host: HOST };
  }
  if (who === "badToken") return { authorization: "Bearer not-a-real-token" };
  return { authorization: `Bearer ${tokens[who]}` };
}

async function request(method: string, path: string, who: Who, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers = { ...(await headersFor(who)), ...init.headers };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${BASE}${path}`, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

async function patchQuestion(id: string, who: Who, json: unknown = { questionText: "Edited" }) {
  return m.questionRoute.PATCH(await request("PATCH", `/api/questions/${id}`, who, { json }), { params: { id } });
}
async function deleteQuestion(id: string, who: Who) {
  return m.questionRoute.DELETE(await request("DELETE", `/api/questions/${id}`, who), { params: { id } });
}
async function deletePaper(id: string, who: Who) {
  return m.paperRoute.DELETE(await request("DELETE", `/api/papers/${id}`, who), { params: { id } });
}
async function upload(who: Who, file: File | null, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append("pdf", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return m.uploadRoute.POST(await request("POST", "/api/papers/upload", who, { body: form, headers }), {});
}

const pdfFile = (bytes: Uint8Array | string, name = "paper.pdf", type = "application/pdf") => new File([bytes as BlobPart], name, { type });

async function expectStatus(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// ─── Setup ─────────────────────────────────────────────────────────────────

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "step1_security_test";
  process.env.JWT_SECRET = "step1-test-jwt-secret-0123456789abcdef";
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

// ─── PATCH /api/questions/[id] ─────────────────────────────────────────────

describe("PATCH /api/questions/[id]", () => {
  test("rejects anonymous requests (401)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "anonymous"), 401);
  });
  test("rejects an invalid or expired login (401)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "badToken"), 401);
  });
  test("rejects students (403)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "studentA"), 403);
  });
  test("rejects teachers, whatever their tuition (403)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "teacherA"), 403);
    await expectStatus(await patchQuestion(ids.unusedQ1, "teacherB"), 403);
  });
  test("rejects a tuition's own account: the bank is shared by every institute (403)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "ownerA"), 403);
  });
  test("rejects accounts with no tuition (403)", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ1, "loner"), 403);
  });
  test("leaves the question unchanged after refused edits", async () => {
    const q = await m.Question.findById(ids.unusedQ1).lean<{ questionText: string }>();
    assert.equal(q?.questionText, "Q1 original");
  });
  test("rejects a wrong admin key (401)", async () => {
    const req = await request("PATCH", `/api/questions/${ids.unusedQ1}`, "anonymous", { json: { questionText: "x" }, headers: { "x-admin-key": "wrong-key-wrong-key-wrong-key" } });
    await expectStatus(await m.questionRoute.PATCH(req, { params: { id: ids.unusedQ1 } }), 401);
  });
  test("rejects an admin cookie sent from another site (403)", async () => {
    const headers = { ...(await headersFor("adminCookie")), origin: "https://evil.example" };
    const req = await request("PATCH", `/api/questions/${ids.unusedQ1}`, "anonymous", { json: { questionText: "x" }, headers });
    await expectStatus(await m.questionRoute.PATCH(req, { params: { id: ids.unusedQ1 } }), 403);
  });
  test("rejects an admin cookie with an opaque Origin: null (403, not 500)", async () => {
    const headers = { ...(await headersFor("adminCookie")), origin: "null" };
    const req = await request("PATCH", `/api/questions/${ids.unusedQ1}`, "anonymous", { json: { questionText: "x" }, headers });
    await expectStatus(await m.questionRoute.PATCH(req, { params: { id: ids.unusedQ1 } }), 403);
  });
  test("validates the id (400) and reports a missing question (404)", async () => {
    await expectStatus(await patchQuestion("not-an-id", "admin"), 400);
    await expectStatus(await patchQuestion(String(new Types.ObjectId()), "admin"), 404);
  });
  test("validates the body (400)", async () => {
    const id = ids.unusedQ1;
    const bad = await m.questionRoute.PATCH(await request("PATCH", `/api/questions/${id}`, "admin", { body: "not json", headers: { "content-type": "application/json" } }), { params: { id } });
    await expectStatus(bad, 400);
    await expectStatus(await patchQuestion(id, "admin", ["questionText"]), 400);
    await expectStatus(await patchQuestion(id, "admin", { questionText: { $gt: "" } }), 400);
    await expectStatus(await patchQuestion(id, "admin", { questionText: "   " }), 400);
    await expectStatus(await patchQuestion(id, "admin", { subject: "Astrology" }), 400);
    await expectStatus(await patchQuestion(id, "admin", { questionNumber: "1" }), 400);
    await expectStatus(await patchQuestion(id, "admin", { correctAnswer: "A".repeat(51) }), 400);
    await expectStatus(await patchQuestion(id, "admin", { paperId: ids.attempted }), 400);
  });
  test("lets the platform admin edit, ignoring fields that may not be edited", async () => {
    const body = await expectStatus(
      await patchQuestion(ids.unusedQ1, "admin", { questionText: "Edited by admin", correctAnswer: "B", difficulty: "Hard", paperId: ids.attempted, _id: ids.unusedQ2, diagramUrls: ["/evil"] }),
      200
    );
    assert.equal(body.questionText, "Edited by admin");
    assert.equal(body.correctAnswer, "B");
    assert.equal(body.difficulty, "Hard");
    assert.equal(String(body.paperId), ids.unused);
    assert.equal(String(body._id), ids.unusedQ1);
    assert.deepEqual(body.diagramUrls, []);
    const other = await m.Question.findById(ids.unusedQ2).lean<{ questionText: string }>();
    assert.equal(other?.questionText, "Q2 original", "no other question changes");
  });
  test("lets the admin console (cookie from the same site) edit", async () => {
    await expectStatus(await patchQuestion(ids.unusedQ2, "adminCookie", { questionText: "Edited in console" }), 200);
  });
  test("a whole-question save from the web editor works even when old imports stored odd values", async () => {
    // Imports outside the app may leave nulls the edit checks would refuse.
    await m.Question.collection.updateOne({ _id: new Types.ObjectId(ids.unusedQ2) }, { $set: { explanation: null, section: "C" } });
    const stored = await m.Question.findById(ids.unusedQ2).lean<Record<string, unknown>>();
    const body = await expectStatus(await patchQuestion(ids.unusedQ2, "admin", { ...stored, _id: ids.unusedQ2, correctAnswer: "D" }), 200);
    assert.equal(body.correctAnswer, "D");
    // Saving with nothing changed is fine too.
    await expectStatus(await patchQuestion(ids.unusedQ2, "admin", { ...body }), 200);
  });
});

// ─── DELETE /api/questions/[id] ────────────────────────────────────────────

describe("DELETE /api/questions/[id]", () => {
  test("rejects anonymous requests (401)", async () => {
    await expectStatus(await deleteQuestion(ids.unusedQ2, "anonymous"), 401);
  });
  test("rejects students, teachers and tuitions (403)", async () => {
    for (const who of ["studentA", "teacherA", "teacherB", "ownerA"] as const) await expectStatus(await deleteQuestion(ids.unusedQ2, who), 403);
    assert.ok(await m.Question.exists({ _id: ids.unusedQ2 }));
  });
  test("refuses to delete questions student history uses (409)", async () => {
    for (const id of [ids.attemptedQ, ids.practisedQ, ids.testedQ]) {
      await expectStatus(await deleteQuestion(id, "admin"), 409);
      assert.ok(await m.Question.exists({ _id: id }), "question kept");
    }
  });
  test("validates the id (400) and reports a missing question (404)", async () => {
    await expectStatus(await deleteQuestion("123", "admin"), 400);
    await expectStatus(await deleteQuestion(String(new Types.ObjectId()), "admin"), 404);
  });
  test("lets the admin delete an unused question, keeping the paper's count true", async () => {
    await m.Paper.updateOne({ _id: ids.unused }, { totalQuestions: 2 });
    await expectStatus(await deleteQuestion(ids.unusedQ2, "admin"), 200);
    assert.equal(await m.Question.exists({ _id: ids.unusedQ2 }), null);
    const paper = await m.Paper.findById(ids.unused).lean<{ totalQuestions: number }>();
    assert.equal(paper?.totalQuestions, 1);
  });
});

// ─── DELETE /api/papers/[id] ───────────────────────────────────────────────

describe("DELETE /api/papers/[id]", () => {
  test("rejects anonymous requests (401)", async () => {
    await expectStatus(await deletePaper(ids.unused, "anonymous"), 401);
  });
  test("rejects students, teachers and tuitions (403)", async () => {
    for (const who of ["studentA", "teacherA", "teacherB", "ownerA"] as const) await expectStatus(await deletePaper(ids.unused, who), 403);
    assert.ok(await m.Paper.exists({ _id: ids.unused }));
  });
  test("never destroys a student's attempts: refuses the delete (409) and keeps everything", async () => {
    await expectStatus(await deletePaper(ids.attempted, "admin"), 409);
    assert.ok(await m.Paper.exists({ _id: ids.attempted }));
    assert.equal(await m.Attempt.countDocuments({ paperId: ids.attempted }), 1);
    assert.equal(await m.Question.countDocuments({ paperId: ids.attempted }), 1);
    assert.equal(await m.StoredFile.countDocuments({ paperId: ids.attempted }), 1);
  });
  test("refuses papers whose questions were practised (409)", async () => {
    await expectStatus(await deletePaper(ids.practised, "admin"), 409);
    assert.ok(await m.Question.exists({ _id: ids.practisedQ }));
  });
  test("validates the id (400) and reports a missing paper (404)", async () => {
    await expectStatus(await deletePaper("zzz", "admin"), 400);
    await expectStatus(await deletePaper(String(new Types.ObjectId()), "admin"), 404);
  });
  test("lets the admin delete an unused paper with its own questions and files only", async () => {
    const filesBefore = await m.StoredFile.countDocuments({});
    await expectStatus(await deletePaper(ids.unused, "admin"), 200);
    assert.equal(await m.Paper.exists({ _id: ids.unused }), null);
    assert.equal(await m.Question.countDocuments({ paperId: ids.unused }), 0);
    assert.equal(await m.StoredFile.countDocuments({}), filesBefore - 1);
    assert.equal(await m.Attempt.countDocuments({}), 1, "other papers' attempts untouched");
  });
});

// ─── POST /api/papers/upload ───────────────────────────────────────────────

describe("POST /api/papers/upload", () => {
  const tinyPdf = () => pdfFile("%PDF-1.4\n%%EOF\n");

  test("rejects anonymous uploads (401)", async () => {
    await expectStatus(await upload("anonymous", tinyPdf()), 401);
  });
  test("rejects students, teachers and tuitions (403)", async () => {
    for (const who of ["studentA", "teacherA", "ownerA"] as const) await expectStatus(await upload(who, tinyPdf()), 403);
  });
  test("refuses an oversized body from its Content-Length, before reading it (413)", async () => {
    await expectStatus(await upload("admin", tinyPdf(), {}, { "content-length": String(50 * 1024 * 1024) }), 413);
  });
  test("cuts off an oversized body sent without a Content-Length (413)", async () => {
    const big = new Uint8Array(20 * 1024 * 1024);
    big.set(Buffer.from("%PDF-1.4"));
    await expectStatus(await upload("admin", pdfFile(big)), 413);
  });
  test("refuses a file just over the 15 MB limit (413)", async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    big.set(Buffer.from("%PDF-1.4"));
    await expectStatus(await upload("admin", pdfFile(big)), 413);
  });
  test("refuses files that aren't PDFs, whatever their name or type (400)", async () => {
    await expectStatus(await upload("admin", pdfFile("just text", "paper.pdf")), 400);
    await expectStatus(await upload("admin", pdfFile("MZ\x90\x00", "paper.exe", "application/octet-stream")), 400);
    await expectStatus(await upload("admin", null), 400);
  });
  test("refuses bad details before any extraction (400)", async () => {
    const filesBefore = await m.StoredFile.countDocuments({});
    await expectStatus(await upload("admin", tinyPdf(), { examType: "SAT" }), 400);
    await expectStatus(await upload("admin", tinyPdf(), { difficulty: "Mid" }), 400);
    await expectStatus(await upload("admin", tinyPdf(), { subject: "History" }), 400);
    await expectStatus(await upload("admin", tinyPdf(), { year: "20x4" }), 400);
    assert.equal(await m.StoredFile.countDocuments({}), filesBefore, "nothing stored");
  });
  test("a PDF that can't be read fails with a plain message and leaves nothing behind", async () => {
    const before = { files: await m.StoredFile.countDocuments({}), papers: await m.Paper.countDocuments({}) };
    const body = await expectStatus(await upload("admin", pdfFile("%PDF-1.7\nthis is not really a pdf")), 500);
    assert.equal(body.error, "Something went wrong on the server. Try again.");
    assert.equal(await m.StoredFile.countDocuments({}), before.files);
    assert.equal(await m.Paper.countDocuments({}), before.papers);
  });
  test("the admin's upload still extracts questions from a real paper", { timeout: 120000 }, async () => {
    const bytes = readFileSync(join(process.cwd(), "Kinematics__1173736_1_1787560756 (1).pdf"));
    const res = await upload("admin", pdfFile(bytes, "Kinematics.pdf"), { title: "Kinematics", subject: "Physics", standard: "11th", year: "2024" });
    const body = await expectStatus(res, 201);
    assert.ok(body.questionCount > 0, "questions extracted");
    assert.equal(await m.Question.countDocuments({ paperId: body.paper._id }), body.questionCount);
    assert.ok(await m.StoredFile.exists({ paperId: body.paper._id, kind: "pdf" }), "PDF stored");
  });
});

// ─── Existing logins and features ──────────────────────────────────────────

describe("compatibility", () => {
  test("app logins (JWT) still work on the tuition routes", async () => {
    for (const who of ["studentA", "teacherA", "ownerA", "loner"] as const) {
      const body = await expectStatus(await m.meRoute.GET(await request("GET", "/api/auth/me", who), {}), 200);
      assert.ok(body.user.id);
    }
  });
  test("a student can still start a test, and bank edits don't change it", async () => {
    await expectStatus(await patchQuestion(ids.testedQ, "admin", { questionText: "Changed in the bank" }), 200);
    const req = await request("POST", `/api/tests/${ids.testRoom}/start`, "studentA");
    const body = await expectStatus(await m.startRoute.POST(req, { params: { id: ids.testRoom } }), 200);
    assert.equal(body.questions.length, 1);
    assert.equal(body.questions[0].questionText, "Q1 original");
  });
  test("teachers and tuitions still can't start a student's test", async () => {
    const req = await request("POST", `/api/tests/${ids.testRoom}/start`, "teacherA");
    await expectStatus(await m.startRoute.POST(req, { params: { id: ids.testRoom } }), 403);
  });
  test("reading a paper (GET) stays open, as the web reader and app need", async () => {
    const res = await m.paperRoute.GET(await request("GET", `/api/papers/${ids.attempted}`, "anonymous"), { params: { id: ids.attempted } });
    const body = await expectStatus(res, 200);
    assert.equal(body.questions.length, 1);
  });
});
