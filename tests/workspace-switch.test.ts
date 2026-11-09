// A tuition admin opening the Teacher workspace with the same account, against
// a throwaway in-memory MongoDB. Run with: npx tsx --test tests/workspace-switch.test.ts
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer | undefined;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [batches, assign, teachers, teacher, adminTuitions, adminTuition, overview, auth, db] = await Promise.all([
    import("@/app/api/tuition/batches/route"),
    import("@/app/api/tuition/batches/[id]/teachers/route"),
    import("@/app/api/tuition/teachers/route"),
    import("@/app/api/tuition/teachers/[id]/route"),
    import("@/app/api/admin/tuitions/route"),
    import("@/app/api/admin/tuitions/[id]/route"),
    import("@/app/api/teacher/overview/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    batches,
    assign,
    teachers,
    teacher,
    adminTuitions,
    adminTuition,
    overview,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const req = (method: string, path: string, who: string, workspace?: string, body?: unknown) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      ...(workspace ? { "x-workspace": workspace } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const ctx = (id: string) => ({ params: { id } });
const myBatches = async (who: string, workspace?: string, status = 200) =>
  json(await m.overview.GET(req("GET", "/api/teacher/overview", who, workspace), {}), status);

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "workspace_switch_test";
  process.env.JWT_SECRET = "workspace-switch-jwt-secret-0123456789abcdef";
  process.env.ADMIN_API_KEY = "workspace-switch-admin-key-0123456789abcdef";
  m = await load();
  await m.db.connectDB();

  const tuition = await m.Tuition.create({ name: "Nanded Classes" });
  const other = await m.Tuition.create({ name: "Other Classes" });
  const user = (email: string, role: string, extra: Record<string, unknown> = {}, tid: unknown = tuition._id) =>
    m.User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: tid, emailVerified: true, ...extra });
  const owner = await user("owner@test.local", "tuition");
  const otherOwner = await user("other-owner@test.local", "tuition", {}, other._id);
  const asha = await user("asha@test.local", "teacher", { subjects: ["Physics"] });
  const kid = await user("kid@test.local", "student");
  for (const [key, u] of Object.entries({ owner, otherOwner, asha, kid })) {
    tokens[key] = await m.auth.signToken(u);
    ids[key] = String(u._id);
  }
  ids.tuition = String(tuition._id);
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("workspaces an account may open", () => {
  test("only a tuition admin has the Teacher workspace as well", () => {
    assert.deepEqual(m.auth.workspacesOf("tuition"), ["tuition", "teacher"]);
    assert.deepEqual(m.auth.workspacesOf("teacher"), ["teacher"]);
    assert.deepEqual(m.auth.workspacesOf("student"), ["student"]);
    assert.deepEqual(m.auth.workspacesOf(null), []);
  });
});

describe("the admin teaching from the same account", () => {
  let batchId: string;
  let otherBatchId: string;

  test("the admin is offered for assignment but is not listed as a teacher", async () => {
    const body = await json(await m.teachers.GET(req("GET", "/api/tuition/teachers", "owner"), {}), 200);
    assert.equal(body.self.id, ids.owner);
    assert.ok(!body.teachers.some((t: { id: string }) => t.id === ids.owner));
    assert.ok(body.teachers.some((t: { id: string }) => t.id === ids.asha));
  });

  test("the admin can be assigned to a batch subject; the batch count stays one account", async () => {
    batchId = (await json(await m.batches.POST(req("POST", "/api/tuition/batches", "owner", undefined, { program: "JEE", standard: "11th", name: "JEE 11th A" }), {}), 200)).batch.id;
    otherBatchId = (await json(await m.batches.POST(req("POST", "/api/tuition/batches", "owner", undefined, { program: "JEE", standard: "12th", name: "JEE 12th B" }), {}), 200)).batch.id;
    const put = await json(
      await m.assign.PUT(req("PUT", `/api/tuition/batches/${batchId}/teachers`, "owner", undefined, { teacherId: ids.owner, subjects: ["Physics"] }), ctx(batchId)),
      200
    );
    assert.deepEqual(put.batch.teachers.map((t: { teacherId: string }) => t.teacherId), [ids.owner]);
    assert.equal(await m.User.countDocuments({ email: "owner@test.local" }), 1);
  });

  test("another tuition's admin cannot be assigned", async () => {
    await json(
      await m.assign.PUT(req("PUT", `/api/tuition/batches/${batchId}/teachers`, "owner", undefined, { teacherId: ids.otherOwner, subjects: ["Physics"] }), ctx(batchId)),
      400
    );
  });

  test("Teacher workspace shows only the batches the admin teaches", async () => {
    const body = await myBatches("owner", "teacher");
    assert.deepEqual(body.batches.map((b: { id: string }) => b.id), [batchId]);
    assert.ok(!body.batches.some((b: { id: string }) => b.id === otherBatchId));
  });

  test("an admin with no assignments gets an empty Teacher workspace, not every batch", async () => {
    const body = await myBatches("otherOwner", "teacher");
    assert.deepEqual(body.batches, []);
  });

  test("Teacher workspace takes away admin-only routes; Admin workspace keeps them", async () => {
    await json(await m.batches.GET(req("GET", "/api/tuition/batches", "owner", "teacher"), {}), 403);
    const all = await json(await m.batches.GET(req("GET", "/api/tuition/batches", "owner", "tuition"), {}), 200);
    assert.equal(all.batches.length, 2);
    await json(await m.batches.GET(req("GET", "/api/tuition/batches", "owner"), {}), 200);
  });

  test("teacher-only routes need the Teacher workspace", async () => {
    await myBatches("owner", undefined, 403);
    await myBatches("owner", "tuition", 403);
  });
});

describe("the workspace header never grants anything", () => {
  test("a teacher asking for another workspace stays a teacher", async () => {
    for (const ws of ["tuition", "admin", "teacher", "student"]) {
      await json(await m.batches.GET(req("GET", "/api/tuition/batches", "asha", ws), {}), 403);
      await myBatches("asha", ws);
    }
  });

  test("a student cannot use it to reach teacher or admin routes", async () => {
    await myBatches("kid", "teacher", 403);
    await json(await m.batches.GET(req("GET", "/api/tuition/batches", "kid", "teacher"), {}), 403);
  });
});

describe("the admin's own name and the admin as a listed teacher", () => {
  const adminReq = (method: string, path: string, body?: unknown) =>
    new NextRequest(`${BASE}${path}`, {
      method,
      headers: { "x-admin-key": process.env.ADMIN_API_KEY!, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let tuitionId: string;

  test("a new tuition's login is named after its admin, not the tuition", async () => {
    const made = await json(
      await m.adminTuitions.POST(adminReq("POST", "/api/admin/tuitions", { name: "Sharma Classes", adminName: "Rakesh Sharma", loginEmail: "rakesh@test.local", password: "longpassword1" }), {}),
      200
    );
    tuitionId = made.tuition.id;
    assert.equal((await m.User.findOne({ email: "rakesh@test.local" }))?.name, "Rakesh Sharma");
    const row = (await json(await m.adminTuitions.GET(adminReq("GET", "/api/admin/tuitions"), {}), 200)).tuitions.find((t: { id: string }) => t.id === tuitionId);
    assert.equal(row.adminName, "Rakesh Sharma");
  });

  test("without an admin name (older scripts) the login is named after the tuition", async () => {
    await json(await m.adminTuitions.POST(adminReq("POST", "/api/admin/tuitions", { name: "Old Script Classes", loginEmail: "old@test.local", password: "longpassword1" }), {}), 200);
    assert.equal((await m.User.findOne({ email: "old@test.local" }))?.name, "Old Script Classes");
  });

  test("renaming the tuition leaves the admin's name; the admin's name is edited on its own", async () => {
    await json(await m.adminTuition.PATCH(adminReq("PATCH", `/api/admin/tuitions/${tuitionId}`, { name: "Sharma Academy" }), ctx(tuitionId)), 200);
    assert.equal((await m.User.findOne({ email: "rakesh@test.local" }))?.name, "Rakesh Sharma");
    await json(await m.adminTuition.PATCH(adminReq("PATCH", `/api/admin/tuitions/${tuitionId}`, { adminName: "Rakesh S." }), ctx(tuitionId)), 200);
    assert.equal((await m.User.findOne({ email: "rakesh@test.local" }))?.name, "Rakesh S.");
    const detail = await json(await m.adminTuition.GET(adminReq("GET", `/api/admin/tuitions/${tuitionId}`), ctx(tuitionId)), 200);
    assert.equal(detail.login.name, "Rakesh S.");
  });

  test("the admin's own details open from the teachers list, read-only; no one else's do", async () => {
    const own = await json(await m.teacher.GET(req("GET", `/api/tuition/teachers/${ids.owner}`, "owner"), ctx(ids.owner)), 200);
    assert.equal(own.teacher.id, ids.owner);
    await json(await m.teacher.PATCH(req("PATCH", `/api/tuition/teachers/${ids.owner}`, "owner", undefined, { name: "X" }), ctx(ids.owner)), 404);
    await json(await m.teacher.DELETE(req("DELETE", `/api/tuition/teachers/${ids.owner}`, "owner"), ctx(ids.owner)), 404);
    assert.equal((await m.User.findById(ids.owner))?.role, "tuition");
    await json(await m.teacher.GET(req("GET", `/api/tuition/teachers/${ids.otherOwner}`, "owner"), ctx(ids.otherOwner)), 404);
  });
});
