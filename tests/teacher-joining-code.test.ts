// Teacher invitations: the institute's teacher code, a registered teacher's
// request (with PCMB subjects), the tuition approving it, and the existing
// batch assignment afterwards. Runs the real route handlers against a
// throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [teacherInvite, batchInvite, validate, join, mine, teacherList, approve, reject, teachers, batch, teacherOverview, enrollments, db, auth] = await Promise.all([
    import("@/app/api/tuition/teacher-invite/route"),
    import("@/app/api/tuition/batches/[id]/invite/route"),
    import("@/app/api/join-requests/validate/route"),
    import("@/app/api/join-requests/route"),
    import("@/app/api/join-requests/mine/route"),
    import("@/app/api/tuition/join-requests/route"),
    import("@/app/api/tuition/join-requests/[id]/accept/route"),
    import("@/app/api/tuition/join-requests/[id]/reject/route"),
    import("@/app/api/tuition/teachers/route"),
    import("@/app/api/tuition/batches/[id]/route"),
    import("@/app/api/teacher/overview/route"),
    import("@/app/api/tuition/enrollments/route"),
    import("@/lib/db"),
    import("@/lib/auth"),
  ]);
  return {
    teacherInvite, batchInvite, validate, join, mine, teacherList, approve, reject, teachers, batch, teacherOverview, enrollments, db, auth,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    BatchInvite: (await import("@/models/BatchInvite")).default,
    JoinRequest: (await import("@/models/JoinRequest")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const make = (who: string, role: string | null, tuitionId: unknown = null, extra: object = {}) =>
  m.User.create({ email: `${who}@test.local`, name: who, passwordHash: "x", role, tuitionId, emailVerified: true, ...extra });

async function newPerson(name: string, extra: object = {}) {
  const user = await make(name, null, null, extra);
  tokens[name] = await m.auth.signToken(user);
  ids[name] = String(user._id);
  return user;
}

const req = (method: string, who: string, body?: unknown) =>
  new NextRequest(`${BASE}/`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function out(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const inviteGet = async (who = "adminA", status = 200) => (await out(await m.teacherInvite.GET(req("GET", who), {}), status)).invite;
const inviteDo = async (body: object, who = "adminA", status = 200) => (await out(await m.teacherInvite.POST(req("POST", who, body), {}), status)).invite;
const teacherCode = async (who = "adminA") => ((await inviteGet(who)).code as string).replace("-", "");
const studentCode = async (batch = "batchA") => ((await out(await m.batchInvite.GET(req("GET", "adminA"), { params: { id: ids[batch] } }), 200)).invite.code as string).replace("-", "");
const check = async (who: string, code: unknown, status = 200) => out(await m.validate.POST(req("POST", who, { code }), {}), status);
const ask = async (who: string, code: unknown, subjects?: unknown, status = 200) => out(await m.join.POST(req("POST", who, { code, subjects }), {}), status);
const pendingTeachers = async (who = "adminA") => (await out(await m.teacherList.GET(req("GET", who), {}), 200)).requests as { id: string; subjects: string[]; createdAt: string; person: { name: string; email: string; emailVerified: boolean } }[];
const requestId = async (name: string) => (await pendingTeachers()).find((r) => r.person.name === name)!.id;
const approve = async (who: string, id: string, status = 200) => out(await m.approve.POST(req("POST", who), { params: { id } }), status);

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "teacher_joining_code";
  process.env.JWT_SECRET = "joining-code-test-jwt-secret-0123456789";
  m = await load();
  await m.db.connectDB();
  await m.JoinRequest.syncIndexes();
  await m.BatchInvite.syncIndexes();

  const tuitionA = await m.Tuition.create({ name: "Alpha Classes" });
  const tuitionB = await m.Tuition.create({ name: "Beta Classes" });
  const adminA = await make("adminA", "tuition", tuitionA._id);
  const adminB = await make("adminB", "tuition", tuitionB._id);
  const student = await make("student", "student", tuitionA._id);
  const batchA = await m.Batch.create({ tuitionId: tuitionA._id, name: "11th NEET", program: "NEET", track: "NEET", standard: "11th", subjects: ["Physics", "Chemistry", "Biology"] });
  Object.assign(ids, { tuitionA: String(tuitionA._id), tuitionB: String(tuitionB._id), batchA: String(batchA._id) });
  for (const [k, u] of Object.entries({ adminA, adminB, student })) tokens[k] = await m.auth.signToken(u);
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("the institute's teacher code", () => {
  test("is made on first use, 8 unambiguous characters, with the institute's name and no batch", async () => {
    const first = await inviteGet();
    assert.equal(first.status, "active");
    assert.match(first.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    assert.equal(first.institute, "Alpha Classes");
    assert.ok(!("batch" in first));
    assert.ok(first.expiresAt);
  });

  test("is reusable: shown again unchanged, one per institute, stored only as hash and ciphertext", async () => {
    const code = await teacherCode();
    assert.equal(await teacherCode(), code);
    assert.equal(await m.BatchInvite.countDocuments({ tuitionId: ids.tuitionA, kind: "teacher" }), 1);
    const raw = JSON.stringify(await m.BatchInvite.findOne({ tuitionId: ids.tuitionA, kind: "teacher" }).lean());
    assert.ok(!raw.includes(code));
    assert.notEqual(await teacherCode("adminB"), code, "each institute has its own code");
  });

  test("only the tuition account manages it", async () => {
    await out(await m.teacherInvite.GET(req("GET", "student"), {}), 403);
    await out(await m.teacherInvite.POST(req("POST", "student", { action: "revoke" }), {}), 403);
    await inviteDo({ action: "nonsense" }, "adminA", 400);
  });

  test("expiry can be set and updated; an expired code stops working", async () => {
    await newPerson("expiryT");
    const code = await teacherCode();
    await check("expiryT", code);
    await m.BatchInvite.updateOne({ tuitionId: ids.tuitionA, kind: "teacher" }, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await inviteGet()).status, "expired");
    await check("expiryT", code, 404);
    const extended = await inviteDo({ action: "extend", expiresInDays: 30 });
    assert.equal(extended.status, "active");
    await check("expiryT", code);
    await inviteDo({ action: "extend", expiresInDays: 0 }, "adminA", 400);
  });

  test("regenerating stops the old code at once", async () => {
    await newPerson("regenT");
    const old = await teacherCode();
    const next = await inviteDo({ action: "regenerate", expiresInDays: 90 });
    assert.notEqual(next.code.replace("-", ""), old);
    await check("regenT", old, 404);
    await check("regenT", next.code);
  });

  test("revoking turns it off until a new code is made", async () => {
    await newPerson("revokeT");
    const code = await teacherCode();
    const off = await inviteDo({ action: "revoke" });
    assert.equal(off.status, "revoked");
    assert.equal(off.code, null);
    await check("revokeT", code, 404);
    await inviteDo({ action: "extend", expiresInDays: 30 }, "adminA", 409);
    const again = await inviteDo({ action: "regenerate" });
    assert.equal(again.status, "active");
    await check("revokeT", again.code);
  });
});

describe("teacher and student codes stay apart", () => {
  test("a teacher code leads to the institute, a batch code to its batch", async () => {
    await newPerson("sep");
    const t = (await check("sep", await teacherCode())).preview;
    assert.deepEqual(t, { kind: "teacher", institute: "Alpha Classes", batch: null });
    const s = (await check("sep", await studentCode())).preview;
    assert.equal(s.kind, "batch");
    assert.equal(s.batch.name, "11th NEET");
  });

  test("a batch code never makes a teacher, whatever the caller sends", async () => {
    await newPerson("sneaky");
    const { request } = await ask("sneaky", await studentCode(), ["Physics"]);
    assert.equal(request.role, "student");
    const row = await m.JoinRequest.findOne({ userId: ids.sneaky }).lean<{ role: string; subjects: string[]; batchId: unknown }>();
    assert.equal(row!.role, "student");
    assert.deepEqual(row!.subjects, []);
    assert.ok(row!.batchId);
    assert.ok(!(await pendingTeachers()).some((r) => r.person.name === "sneaky"));
  });

  test("a role field in the body is ignored", async () => {
    await newPerson("selfpick");
    const res = await m.join.POST(req("POST", "selfpick", { code: await studentCode(), subjects: ["Physics"], role: "teacher", as: "teacher" }), {});
    assert.equal((await out(res, 200)).request.role, "student");
  });

  test("the old institute-wide code no longer exists", async () => {
    await newPerson("oldcode");
    await m.Tuition.collection.updateOne({ _id: new (await import("mongoose")).Types.ObjectId(ids.tuitionA) }, { $set: { joinCode: "K7Q2M9TA" } });
    await check("oldcode", "K7Q2-M9TA", 404);
  });
});

describe("a teacher asks to join", () => {
  test("must pick at least one PCMB subject, and only those", async () => {
    await newPerson("noSubjects");
    const code = await teacherCode();
    await ask("noSubjects", code, undefined, 400);
    await ask("noSubjects", code, [], 400);
    await ask("noSubjects", code, ["History"], 400);
    await ask("noSubjects", code, "Physics", 400);
    assert.equal(await m.JoinRequest.countDocuments({ userId: ids.noSubjects }), 0);
  });

  test("a valid request stores the subjects, is pending, and shows in their own status", async () => {
    await newPerson("meera");
    const { request } = await ask("meera", await teacherCode(), ["Physics", "Mathematics", "Physics"]);
    assert.equal(request.status, "pending");
    assert.equal(request.role, "teacher");
    assert.deepEqual(request.subjects, ["Physics", "Mathematics"]);
    const mine = (await out(await m.mine.GET(req("GET", "meera"), {}), 200)).request;
    assert.equal(mine.role, "teacher");
    assert.equal(mine.tuition.name, "Alpha Classes");
    assert.equal(mine.batch, null);
  });

  test("all four subjects are allowed; asking again with the same code updates the subjects, not the request", async () => {
    const before = await m.JoinRequest.countDocuments({ userId: ids.meera, status: "pending" });
    const again = (await ask("meera", await teacherCode(), ["Physics", "Chemistry", "Mathematics", "Biology"])).request;
    assert.deepEqual(again.subjects, ["Physics", "Chemistry", "Mathematics", "Biology"]);
    assert.equal(before, 1);
    assert.equal(await m.JoinRequest.countDocuments({ userId: ids.meera, status: "pending" }), 1);
    await ask("meera", await teacherCode(), ["Physics", "Mathematics"]);
  });

  test("an unverified email cannot ask", async () => {
    await newPerson("unverified", { emailVerified: false });
    await ask("unverified", await teacherCode(), ["Physics"], 403);
  });
});

describe("a pending teacher has no access", () => {
  test("no role, no tuition, and every role-gated API refuses them", async () => {
    const user = await m.User.findById(ids.meera).lean<{ role: unknown; tuitionId: unknown; subjects: unknown[] }>();
    assert.equal(user!.role, null);
    assert.equal(user!.tuitionId, null);
    assert.deepEqual(user!.subjects, [], "subjects stay on the request until approval");
    await out(await m.teacherOverview.GET(req("GET", "meera"), {}), 403);
    await out(await m.teachers.GET(req("GET", "meera"), {}), 403);
    await out(await m.teacherList.GET(req("GET", "meera"), {}), 403);
    await out(await m.enrollments.GET(req("GET", "meera"), {}), 403);
    await out(await m.teacherInvite.GET(req("GET", "meera"), {}), 403);
  });

  test("the pending list gives name, verified email, subjects and date, to the right tuition only", async () => {
    const row = (await pendingTeachers()).find((r) => r.person.name === "meera")!;
    assert.equal(row.person.email, "meera@test.local");
    assert.equal(row.person.emailVerified, true);
    assert.deepEqual(row.subjects, ["Physics", "Mathematics"]);
    assert.ok(row.createdAt);
    assert.deepEqual(await pendingTeachers("adminB"), []);
    await out(await m.teacherList.GET(req("GET", "student"), {}), 403);
  });
});

describe("approving a teacher", () => {
  test("another tuition, a student or the person themselves cannot decide", async () => {
    const id = await requestId("meera");
    await approve("adminB", id, 404);
    await approve("student", id, 403);
    await approve("meera", id, 403);
    assert.equal((await m.JoinRequest.findById(id).lean<{ status: string }>())!.status, "pending");
  });

  test("approval makes them a teacher of this tuition with their subjects, and assigns no batch", async () => {
    const id = await requestId("meera");
    await approve("adminA", id);
    const user = await m.User.findById(ids.meera).lean<{ role: string; tuitionId: unknown; subjects: string[]; batchId: unknown }>();
    assert.equal(user!.role, "teacher");
    assert.equal(String(user!.tuitionId), ids.tuitionA);
    assert.deepEqual(user!.subjects, ["Physics", "Mathematics"]);
    assert.ok(!user!.batchId);
    const request = await m.JoinRequest.findById(id).lean<{ status: string; acceptedAs: string }>();
    assert.deepEqual([request!.status, request!.acceptedAs], ["accepted", "teacher"]);
    assert.equal(await m.Batch.countDocuments({ tuitionId: ids.tuitionA, "teachers.teacherId": ids.meera }), 0);
    await approve("adminA", id, 404);
  });

  test("the Teacher APIs open only after approval (with a fresh sign-in)", async () => {
    tokens.meera = await m.auth.signToken((await m.User.findById(ids.meera))!);
    await out(await m.teacherOverview.GET(req("GET", "meera"), {}), 200);
  });

  test("the tuition's teacher list now includes them, with no batches", async () => {
    const list = (await out(await m.teachers.GET(req("GET", "adminA"), {}), 200)).teachers as { id: string; subjects: string[]; batches: unknown[] }[];
    const meera = list.find((t) => t.id === ids.meera)!;
    assert.deepEqual(meera.subjects, ["Physics", "Mathematics"]);
    assert.equal(meera.batches.length, 0);
  });

  test("rejecting leaves no role, and they can ask again", async () => {
    await newPerson("rohit");
    await ask("rohit", await teacherCode(), ["Biology"]);
    await out(await m.reject.POST(req("POST", "adminB"), { params: { id: await requestId("rohit") } }), 404);
    await out(await m.reject.POST(req("POST", "adminA"), { params: { id: await requestId("rohit") } }), 200);
    const user = await m.User.findById(ids.rohit).lean<{ role: unknown; tuitionId: unknown }>();
    assert.equal(user!.role, null);
    assert.equal(user!.tuitionId, null);
    assert.equal((await out(await m.mine.GET(req("GET", "rohit"), {}), 200)).request.status, "rejected");
    await ask("rohit", await teacherCode(), ["Biology"]);
  });

  test("someone who joined elsewhere in the meantime is not moved", async () => {
    await newPerson("busy");
    await ask("busy", await teacherCode(), ["Chemistry"]);
    const id = await requestId("busy");
    await m.User.updateOne({ _id: ids.busy }, { role: "student", tuitionId: ids.tuitionB });
    await approve("adminA", id, 409);
    const user = await m.User.findById(ids.busy).lean<{ role: string; tuitionId: unknown }>();
    assert.equal(user!.role, "student");
    assert.equal(String(user!.tuitionId), ids.tuitionB);
  });
});

describe("assigning an approved teacher to existing batches", () => {
  const patch = async (who: string, body: object, status = 200) => out(await m.batch.PATCH(req("PATCH", who, body), { params: { id: ids.batchA } }), status);

  test("the tuition assigns them to a batch subject; the batch's other details are kept", async () => {
    const before = await m.Batch.findById(ids.batchA).lean<{ name: string; schedule: unknown[] }>();
    const { batch } = await patch("adminA", { teachers: [{ teacherId: ids.meera, subject: "Physics" }] });
    assert.deepEqual(batch.teachers.map((t: { subject: string }) => t.subject), ["Physics"]);
    const after = await m.Batch.findById(ids.batchA).lean<{ name: string; schedule: unknown[] }>();
    assert.equal(after!.name, before!.name);
    assert.deepEqual(after!.schedule, before!.schedule);
    assert.equal(await m.Batch.countDocuments({ tuitionId: ids.tuitionA }), 1, "no batch was created");
  });

  test("teachers, students and other tuitions cannot assign", async () => {
    await patch("meera", { teachers: [{ teacherId: ids.meera, subject: "Chemistry" }] }, 403);
    await patch("student", { teachers: [{ teacherId: ids.meera, subject: "Chemistry" }] }, 403);
    await patch("adminB", { teachers: [{ teacherId: ids.meera, subject: "Chemistry" }] }, 404);
    const stored = await m.Batch.findById(ids.batchA).lean<{ teachers: unknown[] }>();
    assert.equal(stored!.teachers.length, 1);
  });

  test("a pending (not yet approved) teacher cannot be assigned", async () => {
    await newPerson("waiting");
    await ask("waiting", await teacherCode(), ["Physics"]);
    await patch("adminA", { teachers: [{ teacherId: ids.waiting, subject: "Physics" }] }, 400);
  });
});

describe("student enrollment still works (regression)", () => {
  test("a batch code makes a pending student request that the tuition approves", async () => {
    const { Types } = await import("mongoose");
    const decide = await import("@/app/api/tuition/enrollments/decide/route");
    await newPerson("pupil");
    const { request } = await ask("pupil", await studentCode());
    assert.equal(request.role, "student");
    assert.equal(request.batch.name, "11th NEET");
    const list = (await out(await m.enrollments.GET(req("GET", "adminA"), {}), 200)).enrollments as { id: string; name: string }[];
    const id = list.find((e) => e.name === "pupil")!.id;
    assert.ok(Types.ObjectId.isValid(id));
    const res = await out(await decide.POST(req("POST", "adminA", { ids: [id], action: "approve" }), {}), 200);
    assert.deepEqual(res, { approved: 1, rejected: 0, failed: [] });
    const user = await m.User.findById(ids.pupil).lean<{ role: string; batchId: unknown }>();
    assert.equal(user!.role, "student");
    assert.equal(String(user!.batchId), ids.batchA);
  });

  test("a student's code request needs no subjects, and a teacher request is not in the student list", async () => {
    const list = (await out(await m.enrollments.GET(req("GET", "adminA"), {}), 200)).enrollments as { name: string }[];
    assert.ok(!list.some((e) => ["waiting", "busy", "rohit"].includes(e.name)));
  });
});
