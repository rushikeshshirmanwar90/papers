// The Step 2.5 data migration (scripts/migrations/2026-10-30-step25-academic-programs.mjs)
// against a throwaway in-memory MongoDB: the dry run writes nothing, --apply
// sets only `program` and only where it's certain, running it again changes
// nothing, --verify passes, --rollback undoes exactly its own changes.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { formatPlan, isRemote, databaseNameFor, MIGRATION_ID, planMigration, runMigration } from "../scripts/migrations/2026-10-30-step25-academic-programs.mjs";

const { ObjectId } = mongoose.Types;
let mongod: MongoMemoryServer;
let uri: string;
let client: InstanceType<typeof mongoose.mongo.MongoClient>;
const DB = "pcmb";
const quiet = () => {};
const reasons2 = (list: { id: string | null; reason: string }[], doc: { toString(): string }) => list.filter((r) => r.id === String(doc)).map((r) => r.reason).join(" | ");
const id: Record<string, InstanceType<typeof ObjectId>> = {};

/** Everything in the database, for before/after comparisons. */
async function dump() {
  const db = client.db(DB);
  const out: Record<string, unknown[]> = {};
  for (const c of (await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name).sort()) {
    out[c] = await db.collection(c).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.parse(JSON.stringify(out));
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  client = new mongoose.mongo.MongoClient(uri);
  await client.connect();
  const db = client.db(DB);
  for (const k of ["tuition", "owner", "teacher", "jeeBatch", "neetBatch", "generalBatch", "s12", "s11", "sGeneral", "sNoTrack", "sMismatch", "sDone", "joiner", "q", "attempt", "practice"]) id[k] = new ObjectId();
  await db.collection("tuitions").insertOne({ _id: id.tuition, name: "T", active: true });
  const user = (extra: Record<string, unknown>) => ({ email: `${String(extra._id)}@x`, name: "n", passwordHash: `hash-${String(extra._id)}`, tokenVersion: 0, active: true, tuitionId: id.tuition, subjects: [], ...extra });
  await db.collection("users").insertMany([
    user({ _id: id.owner, role: "tuition" }),
    user({ _id: id.teacher, role: "teacher", subjects: ["Physics"] }),
    // Like the live data: a JEE 12th batch with a 12th and an 11th student.
    user({ _id: id.s12, role: "student", track: "JEE", standard: "12th", batchId: id.jeeBatch }),
    user({ _id: id.s11, role: "student", track: "JEE", standard: "11th", batchId: id.jeeBatch }),
    user({ _id: id.sGeneral, role: "student", track: "General", standard: "11th", batchId: id.generalBatch }),
    user({ _id: id.sNoTrack, role: "student" }),
    user({ _id: id.sMismatch, role: "student", track: "JEE", standard: "11th", batchId: id.neetBatch }),
    user({ _id: id.sDone, role: "student", program: "NEET", track: "NEET", standard: "11th", batchId: id.neetBatch }),
    user({ _id: id.joiner, role: null, tuitionId: null }),
  ]);
  await db.collection("batches").insertMany([
    { _id: id.jeeBatch, tuitionId: id.tuition, name: "JEE 12", track: "JEE", standard: "12th", subjects: ["Physics"], teachers: [{ teacherId: id.teacher, subject: "Physics" }], schedule: [{ day: 1, start: "07:00", end: "09:00" }], venue: "", active: true },
    { _id: id.neetBatch, tuitionId: id.tuition, name: "NEET 11", track: "NEET", standard: "11th", subjects: ["Biology"], teachers: [], schedule: [], venue: "", active: true },
    { _id: id.generalBatch, tuitionId: id.tuition, name: "General", track: "General", subjects: ["Physics", "Biology"], teachers: [], schedule: [], venue: "", active: true },
  ]);
  // Records the migration must never touch.
  await db.collection("questions").insertOne({ _id: id.q, subject: "Physics", examCategory: "JEE/NEET", source: "JEE MAIN 2022" });
  await db.collection("testattempts").insertOne({ _id: id.attempt, studentId: id.s12, score: 4 });
  await db.collection("practiceanswers").insertOne({ _id: id.practice, studentId: id.s11, correct: true });
});

after(async () => {
  await client?.close();
  await mongod?.stop();
});

describe("safety checks", () => {
  test("the database name is found the way the app finds it", () => {
    assert.equal(databaseNameFor("mongodb+srv://u:p@cluster0.x.mongodb.net/?retryWrites=true", {}), "pcmb");
    assert.equal(databaseNameFor("mongodb://localhost:27017/other", {}), "other");
    assert.equal(databaseNameFor("mongodb://localhost:27017/other", { MONGODB_DB: "pcmb_dev" }), "pcmb_dev");
  });

  test("remote databases are told apart from this computer's", () => {
    assert.equal(isRemote("mongodb+srv://u:p@cluster0.x.mongodb.net/"), true);
    assert.equal(isRemote("mongodb://db.example.com:27017/pcmb"), true);
    assert.equal(isRemote("mongodb://127.0.0.1:27017/"), false);
    assert.equal(isRemote("mongodb://localhost:1234,127.0.0.1:1235/"), false);
  });

  test("writes need the database confirmed, and remote writes need --allow-remote", async () => {
    await assert.rejects(runMigration({ uri, dbName: DB, mode: "apply", log: quiet }), /--confirm-db pcmb/);
    await assert.rejects(runMigration({ uri, dbName: DB, mode: "apply", confirmDb: "pcmb_other", log: quiet }), /--confirm-db pcmb/);
    await assert.rejects(runMigration({ uri: "mongodb+srv://u:p@cluster0.example.mongodb.net/", mode: "apply", confirmDb: "pcmb", log: quiet }), /--allow-remote/);
    await assert.rejects(runMigration({ uri, dbName: "not_the_app", mode: "dry-run", log: quiet }), /no users\/batches/);
  });
});

describe("dry run", () => {
  test("plans only the certain changes and lists the rest for review, writing nothing", async () => {
    const before = await dump();
    const plan = (await runMigration({ uri, dbName: DB, log: quiet })).plan!;
    assert.deepEqual(await dump(), before, "the dry run wrote nothing");
    assert.equal(before.schemamigrations, undefined, "no record collection made by a dry run");

    const changed = Object.fromEntries(plan.changes.map((c) => [c.id, c.set.program]));
    assert.deepEqual(changed, {
      [String(id.jeeBatch)]: "JEE",
      [String(id.neetBatch)]: "NEET",
      [String(id.s12)]: "JEE",
      [String(id.s11)]: "JEE", // certain program; the class mismatch is only reported
    });
    const reasons = (doc: InstanceType<typeof ObjectId>) => plan.review.filter((r) => r.id === String(doc)).map((r) => r.reason).join(" | ");
    assert.match(reasons(id.generalBatch), /could be General Tuition, MHT-CET or HSC/);
    assert.match(reasons(id.sGeneral), /could be General Tuition, MHT-CET or HSC/);
    assert.match(reasons(id.sNoTrack), /no track/);
    assert.match(reasons(id.sMismatch), /track JEE, but their batch is NEET/);
    assert.match(reasons(id.s11), /class 11th, but their batch is for 12th/);
    assert.equal(plan.summary.studentsAlreadyDone, 1);
    assert.ok(plan.notes.some((n) => /no academic year/.test(n.reason)));
    assert.match(reasons2(plan.notes, id.jeeBatch), /1 older time-only class slot \(no subject; 0 subject classes/, "time-only slots are reported, not converted");
    assert.equal(plan.changes.filter((c) => c.collection === "timetableentries").length, 0);

    const text = formatPlan(plan);
    assert.doesNotMatch(text, /@x|hash-|n@/, "no emails or password hashes in the report");
    for (const k of Object.values(id)) assert.doesNotMatch(text, new RegExp(String(k)), "no raw ids in the report");
  });

  test("the plan is a pure function of the data", () => {
    const plan = planMigration({ batches: [{ _id: "b1", tuitionId: "t", track: "NEET", standard: "11th", subjects: ["Biology"] }], users: [], tuitionIds: ["t"] });
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].set.program, "NEET");
  });
});

describe("apply, verify, rollback", () => {
  let before: Record<string, unknown[]>;

  test("apply sets program only, only on the planned records", async () => {
    before = await dump();
    const result = await runMigration({ uri, dbName: DB, mode: "apply", confirmDb: DB, log: quiet });
    assert.equal(result.modified, 4);
    const after = await dump();
    const users = Object.fromEntries((after.users as { _id: string }[]).map((u) => [u._id, u]));
    const was = Object.fromEntries((before.users as { _id: string }[]).map((u) => [u._id, u]));
    for (const [key, doc] of Object.entries(users) as [string, Record<string, unknown>][]) {
      const { program, ...rest } = doc;
      const { program: oldProgram, ...oldRest } = was[key] as Record<string, unknown>;
      assert.deepEqual(rest, oldRest, "nothing but program changes: ids, credentials, roles, tuitions, batches, classes kept");
      if ([String(id.s12), String(id.s11)].includes(key)) assert.equal(program, "JEE");
      else assert.equal(program, oldProgram, "unplanned records keep what they had");
    }
    assert.equal((after.users as unknown[]).length, (before.users as unknown[]).length, "no accounts added or removed");
    for (const c of ["questions", "testattempts", "practiceanswers", "tuitions"]) assert.deepEqual(after[c], before[c], `${c} untouched`);
    const general = (after.batches as { _id: string; program?: string }[]).find((b) => b._id === String(id.generalBatch));
    assert.equal(general!.program, undefined, "the General batch isn't reclassified");
    assert.equal((after.schemamigrations as { _id: string; status: string }[])[0]._id, MIGRATION_ID);
  });

  test("running it again changes nothing", async () => {
    const snapshot = await dump();
    const again = await runMigration({ uri, dbName: DB, mode: "apply", confirmDb: DB, log: quiet });
    assert.equal(again.modified, 0);
    assert.deepEqual(await dump(), snapshot);
  });

  test("verify passes, and notices a protected field changing", async () => {
    const ok = await runMigration({ uri, dbName: DB, mode: "verify", log: quiet });
    assert.equal(ok.ok, true, JSON.stringify(ok.problems));
    assert.equal(ok.checked, 4);
    const users = client.db(DB).collection("users");
    await users.updateOne({ _id: id.s12 }, { $set: { passwordHash: "tampered" } });
    const bad = await runMigration({ uri, dbName: DB, mode: "verify", log: quiet });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(" "), /protected field/);
    await users.updateOne({ _id: id.s12 }, { $set: { passwordHash: `hash-${String(id.s12)}` } });
  });

  test("rollback removes only the values it set, and leaves the rest", async () => {
    const result = await runMigration({ uri, dbName: DB, mode: "rollback", confirmDb: DB, log: quiet });
    assert.equal(result.undone, 4);
    const now = await dump();
    const strip = (d: Record<string, unknown[]>) => ({ ...d, schemamigrations: undefined });
    assert.deepEqual(strip(now), strip(before), "back to exactly the data before the migration");
    const done = (now.users as { _id: string; program?: string }[]).find((u) => u._id === String(id.sDone));
    assert.equal(done!.program, "NEET", "a program set before the migration stays");
    assert.equal((await runMigration({ uri, dbName: DB, mode: "verify", log: quiet })).status, "rolled-back");
  });
});
