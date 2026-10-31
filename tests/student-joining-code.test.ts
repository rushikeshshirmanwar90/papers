// Student joining codes: a batch's code, a registered student's request to join
// it, and the tuition approving or rejecting (one or many). Runs the real route
// handlers against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [invite, validate, join, mine, enrollments, decide, legacyList, legacyAccept, overview, db, auth, batchInvite] = await Promise.all([
    import("@/app/api/tuition/batches/[id]/invite/route"),
    import("@/app/api/join-requests/validate/route"),
    import("@/app/api/join-requests/route"),
    import("@/app/api/join-requests/mine/route"),
    import("@/app/api/tuition/enrollments/route"),
    import("@/app/api/tuition/enrollments/decide/route"),
    import("@/app/api/tuition/join-requests/route"),
    import("@/app/api/tuition/join-requests/[id]/accept/route"),
    import("@/app/api/student/overview/route"),
    import("@/lib/db"),
    import("@/lib/auth"),
    import("@/lib/batch-invite"),
  ]);
  return {
    invite, validate, join, mine, enrollments, decide, legacyList, legacyAccept, overview, db, auth, batchInvite,
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

async function seed() {
  const tuitionA = await m.Tuition.create({ name: "Alpha Classes", address: "Pune" });
  const tuitionB = await m.Tuition.create({ name: "Beta Classes" });
  const adminA = await make("adminA", "tuition", tuitionA._id);
  const adminB = await make("adminB", "tuition", tuitionB._id);
  const teacher = await make("teacher", "teacher", tuitionA._id);
  const member = await make("member", "student", tuitionA._id);
  const batchA = await m.Batch.create({ tuitionId: tuitionA._id, name: "11th NEET", program: "NEET", track: "NEET", standard: "11th", subjects: ["Physics"] });
  const batchA2 = await m.Batch.create({ tuitionId: tuitionA._id, name: "12th JEE", program: "JEE", track: "JEE", standard: "12th", subjects: ["Physics"] });
  const batchCet = await m.Batch.create({ tuitionId: tuitionA._id, name: "CET", program: "MHT_CET_PCM", track: "General", standard: "12th", subjects: ["Physics"] });
  const batchB = await m.Batch.create({ tuitionId: tuitionB._id, name: "Beta batch", program: "JEE", track: "JEE", standard: "11th", subjects: ["Physics"] });
  await m.User.updateOne({ _id: member._id }, { batchId: batchA._id, program: "NEET", track: "NEET", standard: "11th" });
  Object.assign(ids, { tuitionA: String(tuitionA._id), tuitionB: String(tuitionB._id), batchA: String(batchA._id), batchA2: String(batchA2._id), batchCet: String(batchCet._id), batchB: String(batchB._id) });
  for (const [k, u] of Object.entries({ adminA, adminB, teacher, member })) tokens[k] = await m.auth.signToken(u);
}

async function newStudent(name: string, extra: object = {}) {
  const user = await make(name, null, null, extra);
  tokens[name] = await m.auth.signToken(user);
  ids[name] = String(user._id);
  return user;
}

const req = (method: string, path: string, who: string, body?: unknown) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function out(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const inviteGet = async (who: string, batch: string, status = 200) => out(await m.invite.GET(req("GET", "/", who), { params: { id: ids[batch] } }), status);
const inviteDo = async (who: string, batch: string, body: object, status = 200) => out(await m.invite.POST(req("POST", "/", who, body), { params: { id: ids[batch] } }), status);
const codeOf = async (batch: string) => ((await inviteGet("adminA", batch)).invite.code as string).replace("-", "");
const check = async (who: string, code: unknown, status = 200) => out(await m.validate.POST(req("POST", "/", who, { code }), {}), status);
const ask = async (who: string, code: unknown, status = 200) => out(await m.join.POST(req("POST", "/", who, { code }), {}), status);
const pending = async (who = "adminA") => (await out(await m.enrollments.GET(req("GET", "/", who), {}), 200)).enrollments as { id: string; name: string; batch: { id: string; name: string } }[];
const decide = async (who: string, idList: string[], action: string, status = 200) => out(await m.decide.POST(req("POST", "/", who, { ids: idList, action }), {}), status);
const pendingId = async (name: string) => (await pending()).find((p) => p.name === name)!.id;

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "student_joining_code";
  process.env.JWT_SECRET = "joining-code-test-jwt-secret-0123456789";
  m = await load();
  await m.db.connectDB();
  await m.JoinRequest.syncIndexes();
  await m.BatchInvite.syncIndexes();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("a batch's joining code", () => {
  test("is made on first use: 8 characters from the unambiguous alphabet, shown again unchanged", async () => {
    const first = (await inviteGet("adminA", "batchA")).invite;
    assert.equal(first.status, "active");
    assert.match(first.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    assert.equal(first.institute, "Alpha Classes");
    assert.equal(first.batch.name, "11th NEET");
    assert.equal((await inviteGet("adminA", "batchA")).invite.code, first.code);
    assert.ok(first.expiresAt);
  });

  test("is stored as a hash and ciphertext, never as plain text", async () => {
    const code = await codeOf("batchA");
    const raw = JSON.stringify(await m.BatchInvite.findOne({ batchId: ids.batchA }).lean());
    assert.ok(!raw.includes(code), "the plain code must not be in the database");
    assert.match(raw, /codeHash/);
  });

  test("different batches get different codes", async () => {
    assert.notEqual(await codeOf("batchA"), await codeOf("batchA2"));
  });

  test("regenerating makes a new code and stops the old one working", async () => {
    const old = await codeOf("batchA2");
    const fresh = (await inviteDo("adminA", "batchA2", { action: "regenerate" })).invite.code.replace("-", "");
    assert.notEqual(old, fresh);
    assert.equal(await codeOf("batchA2"), fresh);
    await newStudent("regen");
    await check("regen", old, 404);
    assert.equal((await check("regen", fresh)).preview.batch.name, "12th JEE");
  });

  test("two batches can never hold the same active code: the unique index refuses it", async () => {
    const taken = await codeOf("batchA");
    const hash = m.batchInvite.hashCode(taken);
    await assert.rejects(m.BatchInvite.updateOne({ batchId: ids.batchA2 }, { codeHash: hash }), (e: { code?: number }) => e.code === 11000);
  });

  test("revoking turns joining off; a new code turns it back on", async () => {
    const code = await codeOf("batchA2");
    const revoked = (await inviteDo("adminA", "batchA2", { action: "revoke" })).invite;
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.code, null);
    await newStudent("revoker");
    await check("revoker", code, 404);
    assert.equal((await inviteGet("adminA", "batchA2")).invite.status, "revoked");
    await inviteDo("adminA", "batchA2", { action: "extend" }, 409);
    const back = (await inviteDo("adminA", "batchA2", { action: "regenerate", expiresInDays: 30 })).invite;
    assert.equal(back.status, "active");
    assert.equal((await check("revoker", back.code)).preview.batch.name, "12th JEE");
  });

  test("an expired code stops working until it is extended or replaced", async () => {
    const code = await codeOf("batchA2");
    await m.BatchInvite.updateOne({ batchId: ids.batchA2 }, { expiresAt: new Date(Date.now() - 1000) });
    await newStudent("expirer");
    await check("expirer", code, 404);
    assert.equal((await inviteGet("adminA", "batchA2")).invite.status, "expired");
    await inviteDo("adminA", "batchA2", { action: "extend", expiresInDays: 90 });
    assert.equal((await check("expirer", code)).preview.batch.name, "12th JEE");
    await inviteDo("adminA", "batchA2", { action: "extend", expiresInDays: 0 }, 400);
    assert.equal((await inviteDo("adminA", "batchA2", { action: "extend", expiresInDays: null })).invite.expiresAt, null);
  });

  test("a batch of a program without a question bank can't take a code", async () => {
    await inviteGet("adminA", "batchCet", 400);
  });

  test("only that tuition's own account manages it: other tuitions, teachers, students, strangers", async () => {
    await inviteGet("adminB", "batchA", 404);
    await inviteDo("adminB", "batchA", { action: "revoke" }, 404);
    await inviteGet("teacher", "batchA", 403);
    await inviteGet("member", "batchA", 403);
    await newStudent("stranger");
    await inviteGet("stranger", "batchA", 403);
    assert.equal((await inviteGet("adminA", "batchA")).invite.status, "active");
  });

  test("the code is not written to the server log", async () => {
    const lines: string[] = [];
    const orig = [console.log, console.error, console.warn];
    console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const code = await codeOf("batchA");
      await newStudent("logcheck");
      await check("logcheck", code);
      await check("logcheck", "ZZZZZZZZ", 404);
      assert.ok(!lines.join("\n").includes(code));
    } finally {
      [console.log, console.error, console.warn] = orig;
    }
  });
});

describe("a student entering a code", () => {
  test("sees only the institute and batch names before confirming", async () => {
    await newStudent("preview");
    const code = (await codeOf("batchA")).toLowerCase();
    const { preview } = await check("preview", `${code.slice(0, 4)}-${code.slice(4)}`);
    assert.deepEqual(preview, { kind: "batch", institute: "Alpha Classes", batch: { name: "11th NEET", program: "NEET", standard: "11th" } });
    assert.ok(!JSON.stringify(preview).includes(ids.tuitionA), "no internal ids");
  });

  test("with a wrong code gets one generic answer", async () => {
    const wrong = (await check("preview", "ABCD2345", 404)).error;
    assert.match(wrong, /isn't valid, or it has expired/);
    await check("preview", 12345, 404);
    await check("preview", "", 404);
  });

  test("is locked out after too many wrong codes, even for a right one", async () => {
    await newStudent("guesser");
    for (let i = 0; i < 10; i++) await check("guesser", "ABCD2345", 404);
    const locked = await check("guesser", await codeOf("batchA"), 429);
    assert.match(locked.error, /Too many wrong codes/);
    await ask("guesser", await codeOf("batchA"), 429);
    // Someone else is not affected.
    assert.equal((await check("preview", await codeOf("batchA"))).preview.institute, "Alpha Classes");
  });

  test("who already belongs to a tuition, or hasn't verified their email, can't join", async () => {
    await check("member", await codeOf("batchA"), 400);
    await newStudent("unverified", { emailVerified: false });
    await check("unverified", await codeOf("batchA"), 403);
    await ask("unverified", await codeOf("batchA"), 403);
  });

  test("a batch that is turned off no longer takes requests", async () => {
    await newStudent("offbatch");
    const code = await codeOf("batchA2");
    await m.Batch.updateOne({ _id: ids.batchA2 }, { active: false });
    await check("offbatch", code, 404);
    await m.Batch.updateOne({ _id: ids.batchA2 }, { active: true });
    await check("offbatch", code);
  });

  test("an older tuition join code still works, and leads to no batch", async () => {
    await newStudent("legacy");
    await m.Tuition.updateOne({ _id: ids.tuitionB }, { joinCode: "K7Q2M9TA" });
    const { preview } = await check("legacy", "k7q2-m9ta");
    assert.deepEqual(preview, { kind: "tuition", institute: "Beta Classes", batch: null });
  });
});

describe("enrollment requests", () => {
  test("a confirmed request is pending, and shows in the student's own status", async () => {
    await newStudent("amit");
    const { request } = await ask("amit", await codeOf("batchA"));
    assert.equal(request.status, "pending");
    assert.equal(request.tuition.name, "Alpha Classes");
    assert.equal(request.batch.name, "11th NEET");
    const status = (await out(await m.mine.GET(req("GET", "/", "amit"), {}), 200)).request;
    assert.equal(status.status, "pending");
    assert.equal(status.batch.standard, "11th");
  });

  test("asking again with the same code returns the same request, not a second one", async () => {
    const before = (await pending()).filter((p) => p.name === "amit").length;
    const again = (await ask("amit", await codeOf("batchA"))).request;
    assert.equal(again.status, "pending");
    assert.equal((await pending()).filter((p) => p.name === "amit").length, before);
    assert.equal(await m.JoinRequest.countDocuments({ userId: ids.amit, status: "pending" }), 1);
  });

  test("a request for another batch replaces the pending one", async () => {
    await newStudent("switcher");
    await ask("switcher", await codeOf("batchA"));
    await ask("switcher", await codeOf("batchA2"));
    const rows = await m.JoinRequest.find({ userId: ids.switcher }).lean<{ status: string }[]>();
    assert.deepEqual(rows.map((r) => r.status).sort(), ["cancelled", "pending"]);
    assert.equal((await pending()).find((p) => p.name === "switcher")!.batch.name, "12th JEE");
  });

  test("simultaneous requests leave exactly one pending request", async () => {
    await newStudent("racer");
    const code = await codeOf("batchA");
    const answers = await Promise.all(Array.from({ length: 6 }, () => m.join.POST(req("POST", "/", "racer", { code }), {})));
    for (const a of answers) assert.equal(a.status, 200);
    assert.equal(await m.JoinRequest.countDocuments({ userId: ids.racer, status: "pending" }), 1);
  });

  test("pending students have no access to any Student API", async () => {
    await out(await m.overview.GET(req("GET", "/", "amit"), {}), 403);
    const user = await m.User.findById(ids.amit).lean<{ role: unknown; tuitionId: unknown; batchId: unknown }>();
    assert.equal(user!.role, null);
    assert.equal(user!.tuitionId, null);
    assert.ok(!user!.batchId);
  });

  test("the pending list names the student and batch, and only to its own tuition", async () => {
    const list = await pending();
    const amit = list.find((p) => p.name === "amit")!;
    assert.equal(amit.batch.name, "11th NEET");
    assert.ok(!("email" in amit));
    assert.deepEqual(await pending("adminB"), []);
    await out(await m.enrollments.GET(req("GET", "/", "teacher"), {}), 403);
    await out(await m.enrollments.GET(req("GET", "/", "member"), {}), 403);
    await out(await m.enrollments.GET(req("GET", "/", "amit"), {}), 403);
  });

  test("batch requests stay out of the older accept-as-student-or-teacher list, which can't take them", async () => {
    const legacy = (await out(await m.legacyList.GET(req("GET", "/", "adminA"), {}), 200)).requests as { person: { name: string } }[];
    assert.ok(!legacy.some((r) => r.person.name === "amit"));
    const id = await pendingId("amit");
    const res = await m.legacyAccept.POST(req("POST", "/", "adminA", { as: "teacher", subjects: ["Physics"] }), { params: { id } });
    await out(res, 400);
    assert.equal((await m.User.findById(ids.amit).lean<{ role: unknown }>())!.role, null);
  });
});

describe("deciding requests", () => {
  test("only the tuition's own account may decide; nothing changes for anyone else", async () => {
    const id = await pendingId("amit");
    await decide("adminB", [id], "approve", 404);
    await decide("teacher", [id], "approve", 403);
    await decide("member", [id], "approve", 403);
    await decide("amit", [id], "approve", 403);
    assert.equal((await m.JoinRequest.findById(id).lean<{ status: string }>())!.status, "pending");
  });

  test("approving makes the student a member of that batch, and the Student APIs let them in", async () => {
    const id = await pendingId("amit");
    const result = await decide("adminA", [id], "approve");
    assert.deepEqual(result, { approved: 1, rejected: 0, failed: [] });
    const user = await m.User.findById(ids.amit).lean<Record<string, unknown>>();
    assert.equal(String(user!.tuitionId), ids.tuitionA);
    assert.equal(user!.role, "student");
    assert.equal(String(user!.batchId), ids.batchA);
    assert.equal(user!.program, "NEET");
    assert.equal(user!.standard, "11th");
    assert.equal((await m.JoinRequest.findById(id).lean<{ status: string }>())!.status, "accepted");
    assert.equal((await out(await m.mine.GET(req("GET", "/", "amit"), {}), 200)).request.status, "accepted");
    // The same token now opens the Student API.
    await out(await m.overview.GET(req("GET", "/", "amit"), {}), 200);
    assert.ok(!(await pending()).some((p) => p.name === "amit"));
  });

  test("the approved student appears in the batch's student list", async () => {
    const batchRoute = await import("@/app/api/tuition/batches/[id]/route");
    const body = await out(await batchRoute.GET(req("GET", "/", "adminA"), { params: { id: ids.batchA } }), 200);
    assert.ok((body.students as { name: string }[]).some((s) => s.name === "amit"));
  });

  test("deciding a request twice does nothing the second time", async () => {
    const id = String((await m.JoinRequest.findOne({ userId: ids.amit }).lean<{ _id: unknown }>())!._id);
    await decide("adminA", [id], "approve", 404);
  });

  test("bulk approve and bulk reject work in one call each", async () => {
    for (const n of ["b1", "b2", "b3", "b4"]) {
      await newStudent(n);
      await ask(n, await codeOf("batchA"));
    }
    const first = await Promise.all(["b1", "b2"].map(pendingId));
    assert.deepEqual(await decide("adminA", first, "approve"), { approved: 2, rejected: 0, failed: [] });
    const rest = await Promise.all(["b3", "b4"].map(pendingId));
    assert.deepEqual(await decide("adminA", rest, "reject"), { approved: 0, rejected: 2, failed: [] });
    for (const n of ["b1", "b2"]) assert.equal((await m.User.findById(ids[n]).lean<{ role: unknown }>())!.role, "student");
    for (const n of ["b3", "b4"]) {
      const user = await m.User.findById(ids[n]).lean<{ role: unknown; tuitionId: unknown }>();
      assert.equal(user!.role, null);
      assert.equal(user!.tuitionId, null);
      // A rejected request shows as rejected to the student, who can try again.
      assert.equal((await out(await m.mine.GET(req("GET", "/", n), {}), 200)).request.status, "rejected");
      await out(await m.overview.GET(req("GET", "/", n), {}), 403);
    }
  });

  test("a bulk call that includes another tuition's request is refused whole", async () => {
    await newStudent("c1");
    await newStudent("cross");
    await ask("c1", await codeOf("batchA"));
    const bCode = ((await out(await m.invite.GET(req("GET", "/", "adminB"), { params: { id: ids.batchB } }), 200)).invite.code as string).replace("-", "");
    await ask("cross", bCode);
    const mine = await pendingId("c1");
    const theirs = String((await m.JoinRequest.findOne({ userId: ids.cross, status: "pending" }).lean<{ _id: unknown }>())!._id);
    await decide("adminA", [mine, theirs], "approve", 404);
    await decide("adminA", [mine, theirs], "reject", 404);
    assert.equal(await m.JoinRequest.countDocuments({ _id: { $in: [mine, theirs] }, status: "pending" }), 2);
    assert.equal((await m.User.findById(ids.cross).lean<{ role: unknown }>())!.role, null);
    // Their own admin can.
    assert.equal((await decide("adminB", [theirs], "approve")).approved, 1);
    assert.equal(String((await m.User.findById(ids.cross).lean<{ tuitionId: unknown }>())!.tuitionId), ids.tuitionB);
  });

  test("bad input is refused: no ids, too many, not ids, unknown action", async () => {
    await decide("adminA", [], "approve", 400);
    await decide("adminA", ["nope"], "approve", 400);
    await decide("adminA", Array.from({ length: 101 }, () => ids.batchA), "approve", 400);
    await decide("adminA", [ids.batchA], "promote", 400);
  });

  test("someone who joined another tuition meanwhile is reported, not moved", async () => {
    await newStudent("mover");
    await ask("mover", await codeOf("batchA"));
    const id = await pendingId("mover");
    await m.User.updateOne({ _id: ids.mover }, { tuitionId: ids.tuitionB, role: "student" });
    const result = await decide("adminA", [id], "approve");
    assert.equal(result.approved, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(String((await m.User.findById(ids.mover).lean<{ tuitionId: unknown }>())!.tuitionId), ids.tuitionB);
  });

  test("the same request decided at once by two admins is approved only once", async () => {
    await newStudent("twice");
    await ask("twice", await codeOf("batchA"));
    const id = await pendingId("twice");
    const results = await Promise.all([m.decide.POST(req("POST", "/", "adminA", { ids: [id], action: "approve" }), {}), m.decide.POST(req("POST", "/", "adminA", { ids: [id], action: "approve" }), {})]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    const approved = bodies.reduce((n, b) => n + (b.approved ?? 0), 0);
    assert.equal(approved, 1);
    assert.equal(await m.User.countDocuments({ _id: ids.twice, role: "student", batchId: ids.batchA }), 1);
  });

  test("a batch turned off after the request can't be joined", async () => {
    await newStudent("late");
    await ask("late", await codeOf("batchA"));
    const id = await pendingId("late");
    await m.Batch.updateOne({ _id: ids.batchA }, { active: false });
    try {
      const result = await decide("adminA", [id], "approve");
      assert.equal(result.failed.length, 1);
      assert.equal((await m.User.findById(ids.late).lean<{ role: unknown }>())!.role, null);
    } finally {
      await m.Batch.updateOne({ _id: ids.batchA }, { active: true });
    }
  });
});

describe("existing members", () => {
  test("a student who already belongs keeps working, and codes can't change their role", async () => {
    await out(await m.overview.GET(req("GET", "/", "member"), {}), 200);
    await ask("member", await codeOf("batchA2"), 400);
    const user = await m.User.findById(String((await m.User.findOne({ email: "member@test.local" }).lean<{ _id: unknown }>())!._id)).lean<{ role: unknown; batchId: unknown }>();
    assert.equal(user!.role, "student");
    assert.equal(String(user!.batchId), ids.batchA);
  });

  test("a teacher or tuition account can't use a joining code", async () => {
    await check("teacher", await codeOf("batchA"), 400);
    await check("adminA", await codeOf("batchA"), 400);
  });
});

describe("review fixes", () => {
  test("a batch with no class can't take codes or approve students, and the request stays waiting", async () => {
    await newStudent("classless");
    const code = await codeOf("batchA");
    await ask("classless", code);
    const id = await pendingId("classless");
    await m.Batch.collection.updateOne({ _id: new (await import("mongoose")).Types.ObjectId(ids.batchA) }, { $unset: { standard: "" } });
    try {
      await inviteGet("adminA", "batchA", 400);
      await newStudent("classless2");
      await check("classless2", code, 404);
      const result = await decide("adminA", [id], "approve");
      assert.equal(result.approved, 0);
      assert.equal(result.failed.length, 1);
      assert.equal((await m.JoinRequest.findById(id).lean<{ status: string }>())!.status, "pending");
      assert.equal((await m.User.findById(ids.classless).lean<{ role: unknown }>())!.role, null);
    } finally {
      await m.Batch.updateOne({ _id: ids.batchA }, { standard: "11th" });
    }
    const result = await decide("adminA", [id], "approve");
    assert.equal(result.approved, 1);
    assert.equal((await m.User.findById(ids.classless).lean<{ standard: string }>())!.standard, "11th");
  });

  test("a code that can't be read any more is not silently replaced", async () => {
    const code = await codeOf("batchA2");
    const before = await m.BatchInvite.findOne({ batchId: ids.batchA2 }).lean<{ codeHash: string }>();
    await m.BatchInvite.updateOne({ batchId: ids.batchA2 }, { codeCipher: "bad.bad.bad" });
    const shown = (await inviteGet("adminA", "batchA2")).invite;
    assert.equal(shown.code, null);
    assert.equal((await m.BatchInvite.findOne({ batchId: ids.batchA2 }).lean<{ codeHash: string }>())!.codeHash, before!.codeHash);
    await newStudent("unreadable");
    assert.equal((await check("unreadable", code)).preview.batch.name, "12th JEE");
    assert.ok((await inviteDo("adminA", "batchA2", { action: "regenerate" })).invite.code);
  });

  test("a failed account update gives the request back instead of leaving it approved", async () => {
    await newStudent("flaky");
    await ask("flaky", await codeOf("batchA"));
    const id = await pendingId("flaky");
    const original = m.User.updateOne;
    const silence = console.error;
    (m.User as { updateOne: unknown }).updateOne = () => Promise.reject(new Error("db down"));
    console.error = () => {};
    try {
      const result = await decide("adminA", [id], "approve");
      assert.equal(result.failed.length, 1);
    } finally {
      (m.User as { updateOne: unknown }).updateOne = original;
      console.error = silence;
    }
    assert.equal((await m.JoinRequest.findById(id).lean<{ status: string }>())!.status, "pending");
    assert.equal((await decide("adminA", [id], "approve")).approved, 1);
  });
});
