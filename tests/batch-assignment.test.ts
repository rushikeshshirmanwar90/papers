// Unique batch names per tuition, and assigning an institute's teachers to
// batches (several subjects each, several teachers per subject), against a
// throwaway in-memory MongoDB. Run with: npx tsx --test tests/batch-assignment.test.ts
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const NAME_TAKEN = "A batch with this name already exists in your tuition.";

let mongod: MongoMemoryServer | undefined;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [batches, batch, assign, timetable, entry, teacher, auth, db] = await Promise.all([
    import("@/app/api/tuition/batches/route"),
    import("@/app/api/tuition/batches/[id]/route"),
    import("@/app/api/tuition/batches/[id]/teachers/route"),
    import("@/app/api/timetable/route"),
    import("@/app/api/timetable/[id]/route"),
    import("@/app/api/tuition/teachers/[id]/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    batches,
    batch,
    assign,
    timetable,
    entry,
    teacher,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const req = (method: string, path: string, who: string, body?: unknown) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const ctx = (id: string) => ({ params: { id } });
const createBatch = async (name: string, status = 200, who = "owner", extra: Record<string, unknown> = {}) =>
  json(await m.batches.POST(req("POST", "/api/tuition/batches", who, { program: "NEET", standard: "11th", name, ...extra }), {}), status);
const patchBatch = async (id: string, body: Record<string, unknown>, status = 200, who = "owner") =>
  json(await m.batch.PATCH(req("PATCH", `/api/tuition/batches/${id}`, who, body), ctx(id)), status);
const assign = async (batchId: string, teacherId: string, subjects: string[], status = 200, who = "owner") =>
  json(await m.assign.PUT(req("PUT", `/api/tuition/batches/${batchId}/teachers`, who, { teacherId, subjects }), ctx(batchId)), status);
const unassign = async (batchId: string, teacherId: string, status = 200, who = "owner") =>
  json(await m.assign.DELETE(req("DELETE", `/api/tuition/batches/${batchId}/teachers?teacherId=${teacherId}`, who), ctx(batchId)), status);
const addClass = async (body: Record<string, unknown>, status = 200) => json(await m.timetable.POST(req("POST", "/api/timetable", "owner", body), {}), status);

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "batch_assignment_test";
  process.env.JWT_SECRET = "batch-assignment-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await m.Batch.syncIndexes();

  const tuition = await m.Tuition.create({ name: "Nanded Classes" });
  const other = await m.Tuition.create({ name: "Other Classes" });
  const user = (email: string, role: string, extra: Record<string, unknown> = {}, tid: unknown = tuition._id) =>
    m.User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: tid, emailVerified: true, ...extra });
  const owner = await user("owner@test.local", "tuition");
  const otherOwner = await user("other-owner@test.local", "tuition", {}, other._id);
  const asha = await user("asha@test.local", "teacher", { subjects: ["Physics", "Chemistry"] });
  const ravi = await user("ravi@test.local", "teacher", { subjects: ["Physics"] });
  const outsider = await user("outsider@test.local", "teacher", { subjects: ["Physics"] }, other._id);
  for (const [key, u] of Object.entries({ owner, otherOwner, asha, ravi, outsider })) {
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

describe("batch names are unique within a tuition", () => {
  test("a repeat is refused whatever the case or spaces, on create and on rename", async () => {
    const { batch } = await createBatch("11th JEE A");
    for (const dup of ["11th jee a", " 11th JEE A ", "11TH JEE A"]) {
      const res = await createBatch(dup, 409);
      assert.equal(res.error, NAME_TAKEN);
    }
    const second = (await createBatch("11th JEE B")).batch;
    assert.equal((await patchBatch(second.id, { name: " 11th jee a" }, 409)).error, NAME_TAKEN);
    // Renaming a batch to its own name (another case) is fine, and so is a free name.
    await patchBatch(batch.id, { name: "11th jee a" });
    await patchBatch(second.id, { name: "11th JEE C" });
  });

  test("another tuition can use the same name", async () => {
    await createBatch("11th JEE A", 200, "otherOwner");
  });

  test("two requests at once make only one batch", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => m.batches.POST(req("POST", "/api/tuition/batches", "owner", { program: "NEET", standard: "11th", name: "Race" }), {}))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409]);
    assert.equal(await m.Batch.countDocuments({ tuitionId: ids.tuition, name: "Race" }), 1);
  });

  test("older batches that already share a name are left alone and stay editable", async () => {
    const [a, b] = await m.Batch.collection.insertMany([
      { tuitionId: new (await import("mongoose")).Types.ObjectId(ids.tuition), name: "Old twin", track: "JEE", subjects: ["Physics"], teachers: [], schedule: [], venue: "" },
      { tuitionId: new (await import("mongoose")).Types.ObjectId(ids.tuition), name: "Old twin", track: "JEE", subjects: ["Physics"], teachers: [], schedule: [], venue: "" },
    ]).then((r) => Object.values(r.insertedIds).map(String));
    await patchBatch(a, { venue: "Room 1" });
    await patchBatch(b, { venue: "Room 2" });
    assert.equal(await m.Batch.countDocuments({ tuitionId: ids.tuition, name: "Old twin" }), 2);
    // But nobody can make a third one, or rename into the name.
    await createBatch("old TWIN", 409);
  });
});

describe("assigning teachers to a batch", () => {
  let batchId: string;
  let otherBatchId: string;
  before(async () => {
    batchId = (await createBatch("Assign A")).batch.id;
    otherBatchId = (await createBatch("Assign B")).batch.id;
  });

  test("a teacher takes several subjects; a subject can have several teachers", async () => {
    let { batch } = await assign(batchId, ids.asha, ["Physics", "Chemistry"]);
    assert.deepEqual(batch.teachers.map((t: { subject: string }) => t.subject).sort(), ["Chemistry", "Physics"]);
    ({ batch } = await assign(batchId, ids.ravi, ["Physics"]));
    assert.equal(batch.teachers.filter((t: { subject: string }) => t.subject === "Physics").length, 2);
    // Assigning again edits; it never doubles the pair.
    ({ batch } = await assign(batchId, ids.asha, ["Physics", "Chemistry", "Physics"]));
    assert.equal(batch.teachers.length, 3);
    // One teacher in several batches.
    await assign(otherBatchId, ids.asha, ["Physics"]);
  });

  test("only subjects of the batch, only the tuition's own teachers, only a tuition admin", async () => {
    await assign(batchId, ids.asha, ["Mathematics"], 400);
    await assign(batchId, ids.asha, [], 400);
    await assign(batchId, ids.outsider, ["Physics"], 400);
    await assign(batchId, ids.asha, ["Physics"], 403, "asha");
    await assign(batchId, ids.ravi, ["Physics"], 404, "otherOwner");
  });

  test("a teacher can't be in two places at once; scheduling accepts a batch teacher", async () => {
    await addClass({ batchId, subject: "Physics", day: 1, start: "10:00", end: "11:00", teacherId: ids.asha });
    const clash = await m.timetable.POST(
      req("POST", "/api/timetable", "owner", { batchId: otherBatchId, subject: "Physics", day: 1, start: "10:30", end: "11:30", teacherId: ids.asha }),
      {}
    );
    assert.equal(clash.status, 409);
    await addClass({ batchId: otherBatchId, subject: "Physics", day: 1, start: "11:00", end: "12:00", teacherId: ids.asha });
  });

  test("removing a teacher or a subject with scheduled classes is refused", async () => {
    const dropped = await assign(batchId, ids.asha, ["Chemistry"], 409);
    assert.match(dropped.error, /scheduled class/);
    const removed = await unassign(batchId, ids.asha, 409);
    assert.match(removed.error, /scheduled class/);
  });

  test("a teacher without classes is removed from the batch only", async () => {
    const { batch } = await unassign(batchId, ids.ravi);
    assert.equal(batch.teachers.some((t: { teacherId: string }) => t.teacherId === ids.ravi), false);
    assert.ok(await m.User.exists({ _id: ids.ravi, role: "teacher" }), "their account stays");
  });

  test("editing a teacher's profile subjects keeps their batch assignments", async () => {
    const res = await m.teacher.PATCH(req("PATCH", `/api/tuition/teachers/${ids.asha}`, "owner", { subjects: ["Biology"] }), ctx(ids.asha));
    const { teacher } = await json(res, 200);
    assert.deepEqual(teacher.subjects, ["Biology"]);
    assert.ok(teacher.batches.length >= 2, "still assigned to their batches");
    assert.ok(teacher.batches.some((b: { subject: string }) => b.subject === "Physics"));
  });

  test("editing a batch without sending teachers keeps every assignment", async () => {
    const before = (await m.Batch.findById(batchId))!.teachers.length;
    await patchBatch(batchId, { venue: "Room 7" });
    assert.equal((await m.Batch.findById(batchId))!.teachers.length, before);
  });
});
