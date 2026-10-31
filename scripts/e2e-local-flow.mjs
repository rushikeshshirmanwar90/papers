// The Tuition Admin flow end to end, over HTTP, against the LOCAL API
// (`npm run dev:local`), never the live server:
//   create a tuition -> log in -> create a batch -> set its subject
//   timetable -> add a teacher and assign them -> add a student into the
//   batch -> check the batch, and that the teacher and student can log in and
//   see their batch and timetable.
// It also makes a record the way older app versions do, and rehearses the
// Step 2.5 data migration (dry run, apply, verify, rollback) on the local
// database only.
//
//   npm run dev:local                      (in one terminal)
//   node scripts/e2e-local-flow.mjs        (in another)
//   node scripts/e2e-local-flow.mjs --server http://127.0.0.1:3001 --no-migration
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { runMigration } from "./migrations/2026-10-30-step25-academic-programs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const server = String(option("server", "http://localhost:3000")).replace(/\/+$/, "");
const host = new URL(server).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to run against ${server}: this script only talks to the API on this computer.`);
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(join(root, ".local-mongo", "secrets.json"), "utf8"));
const LOCAL_DB = { uri: "mongodb://127.0.0.1:27027/", name: "pcmb_local" };

let step = 0;
const results = [];
async function check(title, fn) {
  step += 1;
  try {
    await fn();
    results.push(`PASS ${String(step).padStart(2)}. ${title}`);
    console.log(results[results.length - 1]);
  } catch (e) {
    results.push(`FAIL ${String(step).padStart(2)}. ${title}: ${e.message}`);
    console.log(results[results.length - 1]);
    throw e;
  }
}

async function call(method, path, { token, body, admin, status = 200 } = {}) {
  const res = await fetch(`${server}/api${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(admin ? { "x-admin-key": secrets.adminApiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  assert.equal(res.status, status, `${method} ${path}: expected ${status}, got ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const login = async (email, password) => (await call("POST", "/auth/login", { body: { email, password } })).token;

const run = Date.now().toString(36);
const mail = (who) => `${who}.${run}@local.test`;
const PASSWORD = "local-pass-123";
const ctx = {};

try {
  await check("the local API answers (and refuses a request without a login)", async () => {
    await call("GET", "/auth/me", { status: 401 });
  });

  await check("Super Admin creates a tuition (admin key)", async () => {
    const res = await call("POST", "/admin/tuitions", { admin: true, body: { name: `Local Classes ${run}`, loginEmail: mail("owner"), password: PASSWORD } });
    assert.ok(res.tuition.id);
  });

  await check("Tuition Admin logs in", async () => {
    ctx.owner = await login(mail("owner"), PASSWORD);
    const me = await call("GET", "/auth/me", { token: ctx.owner });
    assert.equal(me.user.role, "tuition");
  });

  await check("an older app version makes a JEE 12th batch and student with a track only", async () => {
    const { batch } = await call("POST", "/tuition/batches", { token: ctx.owner, body: { track: "JEE", name: "Old app JEE 12", standard: "12th", subjects: ["Physics", "Chemistry", "Mathematics"] } });
    ctx.oldBatch = batch.id;
    const { student } = await call("POST", "/tuition/students", { token: ctx.owner, body: { track: "JEE", standard: "12th", batchId: batch.id, name: "Old App Student", email: mail("oldstudent"), password: PASSWORD } });
    assert.equal(student.program, "JEE");
  });

  await check("Create Batch: NEET 11th, this academic year, NEET subjects", async () => {
    const { batch } = await call("POST", "/tuition/batches", { token: ctx.owner, body: { program: "NEET", track: "NEET", standard: "11th", name: "NEET 11th A", subjects: ["Physics", "Chemistry", "Biology"] } });
    assert.equal(batch.program, "NEET");
    assert.equal(batch.standard, "11th");
    assert.match(batch.academicYear, /^\d{4}-\d{4}$/);
    assert.deepEqual(batch.schedule, [], "no timetable needed to create it");
    ctx.batch = batch.id;
  });

  await check("programs not offered yet are refused for new batches", async () => {
    const res = await call("POST", "/tuition/batches", { token: ctx.owner, status: 400, body: { program: "MHT_CET_PCB", track: "General", standard: "12th", name: "CET" } });
    assert.match(res.error, /isn't offered yet/);
  });

  await check("Set Timetable: Physics Mon 10 AM, Chemistry Mon 12 PM, Biology Tue 10 AM (no teachers yet)", async () => {
    const add = (body) => call("POST", "/timetable", { token: ctx.owner, body: { batchId: ctx.batch, ...body } });
    await add({ subject: "Physics", days: [1], start: "10:00", end: "11:00" });
    await add({ subject: "Chemistry", days: [1], start: "12:00", end: "13:00" });
    const bio = await add({ subject: "Biology", days: [2], start: "10:00", end: "11:00" });
    assert.equal(bio.entries[0].teacher.id, "", "no teacher assigned yet, and that's allowed");
    ctx.biologyClass = bio.entries[0].id;
  });

  await check("one subject on several days at once: Physics Wed and Fri 4 PM, marked Revision", async () => {
    const res = await call("POST", "/timetable", { token: ctx.owner, body: { batchId: ctx.batch, subject: "Physics", days: [3, 5], start: "16:00", end: "17:00", note: "Revision" } });
    assert.deepEqual(res.entries.map((e) => e.day), [3, 5]);
  });

  await check("an overlapping class is refused, and nothing is added for its other days", async () => {
    const before = (await call("GET", `/timetable?batchId=${ctx.batch}`, { token: ctx.owner })).entries.length;
    const res = await call("POST", "/timetable", { token: ctx.owner, status: 409, body: { batchId: ctx.batch, subject: "Biology", days: [4, 1], start: "12:30", end: "13:30" } });
    assert.match(res.error, /overlaps the batch's Chemistry class on Monday/);
    assert.equal((await call("GET", `/timetable?batchId=${ctx.batch}`, { token: ctx.owner })).entries.length, before);
  });

  await check("Add Teacher (Biology), with no timetable or batch needed", async () => {
    const { teacher } = await call("POST", "/tuition/teachers", { token: ctx.owner, body: { name: "Local Teacher", email: mail("teacher"), password: PASSWORD, subjects: ["Biology"] } });
    assert.equal(teacher.active, true);
    ctx.teacher = teacher.id;
  });

  await check("Assign the teacher to the batch for Biology", async () => {
    const { batch } = await call("PATCH", `/tuition/batches/${ctx.batch}`, { token: ctx.owner, body: { teachers: [{ teacherId: ctx.teacher, subject: "Biology" }] } });
    assert.deepEqual(batch.teachers.map((t) => [t.name, t.subject]), [["Local Teacher", "Biology"]]);
    assert.equal(batch.classes.classes, 5, "the subject timetable is kept");
    const { teachers } = await call("GET", "/tuition/teachers", { token: ctx.owner });
    assert.deepEqual(teachers.find((t) => t.id === ctx.teacher).batches.map((b) => b.subject), ["Biology"]);
  });

  await check("give the Biology class its teacher; new Biology classes get them by default", async () => {
    const { entry } = await call("PATCH", `/timetable/${ctx.biologyClass}`, { token: ctx.owner, body: { teacherId: ctx.teacher } });
    assert.equal(entry.teacher.name, "Local Teacher");
    const res = await call("POST", "/timetable", { token: ctx.owner, body: { batchId: ctx.batch, subject: "Biology", days: [4], start: "10:00", end: "11:00" } });
    assert.equal(res.entries[0].teacher.id, ctx.teacher);
  });

  await check("the teacher can't be in two batches at once", async () => {
    const { batch } = await call("POST", "/tuition/batches", { token: ctx.owner, body: { program: "NEET", track: "NEET", standard: "12th", name: "NEET 12th A" } });
    await call("PATCH", `/tuition/batches/${batch.id}`, { token: ctx.owner, body: { teachers: [{ teacherId: ctx.teacher, subject: "Biology" }] } });
    const res = await call("POST", "/timetable", { token: ctx.owner, status: 409, body: { batchId: batch.id, subject: "Biology", days: [2], start: "10:30", end: "11:30" } });
    assert.match(res.error, /teacher already has a Biology class with NEET 11th A on Tuesday/);
    await call("POST", "/timetable", { token: ctx.owner, body: { batchId: batch.id, subject: "Biology", days: [2], start: "11:00", end: "12:00" } });
  });

  await check("Add Student: needs a class, and a batch of the same program and class", async () => {
    await call("POST", "/tuition/students", { token: ctx.owner, status: 400, body: { program: "NEET", track: "NEET", name: "No Class", email: mail("noclass"), password: PASSWORD } });
    await call("POST", "/tuition/students", { token: ctx.owner, status: 400, body: { program: "NEET", track: "NEET", standard: "12th", batchId: ctx.batch, name: "Wrong Class", email: mail("wrongclass"), password: PASSWORD } });
    const { student } = await call("POST", "/tuition/students", { token: ctx.owner, body: { program: "NEET", track: "NEET", standard: "11th", batchId: ctx.batch, name: "Local Student", email: mail("student"), password: PASSWORD } });
    assert.equal(student.program, "NEET");
    assert.equal(student.standard, "11th");
    assert.equal(student.batch.id, ctx.batch);
    assert.equal(student.active, true);
  });

  await check("Verify Batch: program, class, year, subject timetable, teacher and student", async () => {
    const { batch, students } = await call("GET", `/tuition/batches/${ctx.batch}`, { token: ctx.owner });
    assert.equal(batch.program, "NEET");
    assert.equal(batch.standard, "11th");
    assert.match(batch.academicYear, /^\d{4}-\d{4}$/);
    assert.equal(batch.classes.classes, 6);
    assert.deepEqual(batch.classes.days, [1, 2, 3, 4, 5]);
    assert.equal(batch.classes.withoutTeacher, 4, "Physics and Chemistry have no teacher yet");
    assert.deepEqual(batch.schedule, [], "no time-only slots written");
    const { entries } = await call("GET", `/timetable?batchId=${ctx.batch}`, { token: ctx.owner });
    assert.deepEqual(entries.map((e) => `${e.day} ${e.start} ${e.subject}`), ["1 10:00 Physics", "1 12:00 Chemistry", "2 10:00 Biology", "3 16:00 Physics", "4 10:00 Biology", "5 16:00 Physics"]);
    assert.equal(batch.teachers.length, 1);
    assert.equal(batch.studentCount, 1);
    assert.deepEqual(students.map((s) => s.name), ["Local Student"]);
  });

  await check("the teacher logs in and sees the batch", async () => {
    const token = await login(mail("teacher"), PASSWORD);
    const me = await call("GET", "/auth/me", { token });
    assert.equal(me.user.role, "teacher");
    const overview = await call("GET", "/teacher/overview", { token });
    assert.ok(JSON.stringify(overview).includes(ctx.batch));
    assert.deepEqual(overview.week.filter((e) => e.batch.id === ctx.batch).map((e) => `${e.day} ${e.subject}`), ["2 Biology", "4 Biology"], "their own classes in their timetable");
  });

  await check("the student logs in, sees their batch, and practises NEET questions", async () => {
    const token = await login(mail("student"), PASSWORD);
    const me = await call("GET", "/auth/me", { token });
    assert.equal(me.user.role, "student");
    assert.equal(me.user.program, "NEET");
    const home = await call("GET", "/student/overview", { token });
    assert.equal(home.batch?.id, ctx.batch);
    assert.equal(home.week.length, 6, "the whole subject timetable of their batch");
    assert.ok(home.week.some((e) => e.subject === "Chemistry" && !e.teacher.id), "classes without a teacher show too");
    const tree = await call("GET", "/pyq/topics?subject=Biology", { token });
    assert.equal(tree.available, true);
  });

  await check("the older app's student still logs in", async () => {
    const token = await login(mail("oldstudent"), PASSWORD);
    const me = await call("GET", "/auth/me", { token });
    assert.equal(me.user.program, "JEE");
    assert.equal(me.user.batchId, ctx.oldBatch);
  });

  if (!argv.includes("--no-migration")) {
    const db = { uri: LOCAL_DB.uri, dbName: LOCAL_DB.name, log: () => {} };
    await check("migration rehearsal on the LOCAL database: dry run plans the records saved before Step 2", async () => {
      // This server saves a program even for older apps, so make the older
      // app's batch and student look like records saved before Step 2 (no
      // program), as every record in the live database is. Local database only.
      const client = new mongoose.mongo.MongoClient(LOCAL_DB.uri);
      await client.connect();
      try {
        const local = client.db(LOCAL_DB.name);
        const oid = (id) => new mongoose.mongo.ObjectId(id);
        await local.collection("batches").updateOne({ _id: oid(ctx.oldBatch) }, { $unset: { program: "" } });
        await local.collection("users").updateOne({ email: mail("oldstudent") }, { $unset: { program: "" } });
      } finally {
        await client.close();
      }
      const { plan } = await runMigration({ ...db, mode: "dry-run" });
      assert.ok(plan.changes.some((c) => c.id === ctx.oldBatch && c.set.program === "JEE"), "the older app's batch would get JEE");
      assert.ok(!plan.changes.some((c) => c.id === ctx.batch), "batches made by this app version already have a program");
    });
    await check("migration rehearsal: apply, verify, logins still work, rollback", async () => {
      const applied = await runMigration({ ...db, mode: "apply", confirmDb: LOCAL_DB.name });
      assert.ok(applied.modified >= 1);
      const verified = await runMigration({ ...db, mode: "verify" });
      assert.equal(verified.ok, true, JSON.stringify(verified.problems));
      const token = await login(mail("oldstudent"), PASSWORD);
      assert.equal((await call("GET", "/auth/me", { token })).user.program, "JEE");
      const rolled = await runMigration({ ...db, mode: "rollback", confirmDb: LOCAL_DB.name });
      assert.ok(rolled.undone >= applied.modified, "rollback undoes what was applied");
    });
  }

  console.log(`\nAll ${results.length} steps passed against ${server}.`);
} catch {
  console.log(`\nStopped at step ${step}. ${results.filter((r) => r.startsWith("PASS")).length} passed before it.`);
  process.exitCode = 1;
}
