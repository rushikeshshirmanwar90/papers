// The subject-wise timetable (TimetableEntry): classes with a subject, a
// weekday, times and an optional teacher; several days at once; no overlaps
// in a batch; no teacher in two places at once; the student and teacher
// views; older time-only Batch.schedule slots kept as they are.
// Runs the real route handlers against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [timetable, entry, batch, teacher, studentHome, teacherHome, auth, db] = await Promise.all([
    import("@/app/api/timetable/route"),
    import("@/app/api/timetable/[id]/route"),
    import("@/app/api/tuition/batches/[id]/route"),
    import("@/app/api/tuition/teachers/[id]/route"),
    import("@/app/api/student/overview/route"),
    import("@/app/api/teacher/overview/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    timetable,
    entry,
    batch,
    teacher,
    studentHome,
    teacherHome,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    TimetableEntry: (await import("@/models/TimetableEntry")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seed() {
  const { Tuition, User, Batch, auth } = m;
  const tuition = await Tuition.create({ name: "Nanded Classes" });
  const other = await Tuition.create({ name: "Other" });
  const user = (email: string, role: string, extra: Record<string, unknown> = {}, tid: unknown = tuition._id) =>
    User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: tid, emailVerified: true, ...extra });
  const owner = await user("owner@t.local", "tuition");
  const otherOwner = await user("other@t.local", "tuition", {}, other._id);
  const physics = await user("physics@t.local", "teacher", { subjects: ["Physics"] });
  const chemistry = await user("chem@t.local", "teacher", { subjects: ["Chemistry"] });
  const leaving = await user("leaving@t.local", "teacher", { subjects: ["Biology"] });
  const neet = await Batch.create({
    tuitionId: tuition._id,
    name: "NEET 11th A",
    program: "NEET",
    track: "NEET",
    standard: "11th",
    subjects: ["Physics", "Chemistry", "Biology"],
    teachers: [{ teacherId: physics._id, subject: "Physics" }, { teacherId: chemistry._id, subject: "Chemistry" }],
    // Older time-only slots, from before subject-wise timetables.
    schedule: [{ day: 1, start: "07:00", end: "09:00" }],
  });
  const jee = await Batch.create({ tuitionId: tuition._id, name: "JEE 12th A", program: "JEE", track: "JEE", standard: "12th", subjects: ["Physics", "Chemistry", "Mathematics"], teachers: [{ teacherId: physics._id, subject: "Physics" }] });
  const student = await user("student@t.local", "student", { program: "NEET", track: "NEET", standard: "11th", batchId: neet._id });
  Object.assign(ids, { neet: String(neet._id), jee: String(jee._id), physics: String(physics._id), chemistry: String(chemistry._id), leaving: String(leaving._id) });
  for (const [k, u] of Object.entries({ owner, otherOwner, physics, chemistry, student })) tokens[k] = await auth.signToken(u);
}

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
type Entry = { id: string; subject: string; day: number; start: string; end: string; teacher: { id: string; name: string }; note: string; mine: boolean; batch: { id: string } };
const add = async (body: Record<string, unknown>, status = 200, who = "owner") => json(await m.timetable.POST(req("POST", "/api/timetable", who, body), {}), status);
const list = async (who: string, batchId?: string): Promise<Entry[]> =>
  (await json(await m.timetable.GET(req("GET", `/api/timetable${batchId ? `?batchId=${batchId}` : ""}`, who), {}), 200)).entries;
const count = () => m.TimetableEntry.countDocuments({});

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "timetable_subjects_test";
  process.env.JWT_SECRET = "timetable-subjects-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("subject classes", () => {
  test("different subjects on the same day, each with its time and teacher", async () => {
    const physics = (await add({ batchId: ids.neet, subject: "Physics", days: [1], start: "10:00", end: "11:00" })).entries;
    const chemistry = (await add({ batchId: ids.neet, subject: "Chemistry", days: [1], start: "12:00", end: "13:00" })).entries;
    const biology = (await add({ batchId: ids.neet, subject: "Biology", day: 2, start: "10:00", end: "11:00" })).entries;
    assert.equal(physics[0].teacher.id, ids.physics, "the batch's Physics teacher by default");
    assert.equal(chemistry[0].teacher.id, ids.chemistry);
    assert.deepEqual(biology[0].teacher, { id: "", name: "" }, "no Biology teacher: the class has none, and that's allowed");
    const week = await list("owner", ids.neet);
    assert.deepEqual(week.map((e) => `${e.day} ${e.start} ${e.subject}`), ["1 10:00 Physics", "1 12:00 Chemistry", "2 10:00 Biology"]);
  });

  test("one subject on several days at once, all or none", async () => {
    const res = await add({ batchId: ids.neet, subject: "Physics", days: [3, 5, 1], start: "16:00", end: "17:00", note: "Revision" });
    assert.deepEqual(res.entries.map((e: Entry) => e.day), [1, 3, 5]);
    assert.ok(res.entries.every((e: Entry) => e.note === "Revision"), "test or revision sessions use the note");
    const before = await count();
    // Monday 12:30 overlaps Chemistry: Wednesday isn't added either.
    const clash = await add({ batchId: ids.neet, subject: "Biology", days: [1, 3], start: "12:30", end: "13:30" }, 409);
    assert.match(clash.error, /overlaps the batch's Chemistry class on Monday, 12:00 PM–1:00 PM/);
    assert.equal(await count(), before);
  });

  test("back to back is fine; Sunday only when picked", async () => {
    await add({ batchId: ids.neet, subject: "Biology", days: [1], start: "11:00", end: "12:00", teacherId: null });
    const sunday = (await add({ batchId: ids.neet, subject: "Biology", days: [0], start: "09:00", end: "10:00", teacherId: null })).entries;
    assert.equal(sunday[0].day, 0);
    assert.ok(!(await list("owner", ids.neet)).some((e) => e.day === 0 && e.subject !== "Biology"), "nothing is put on Sunday by itself");
  });

  test("checks: subjects of the batch, a teacher of that subject, real times and days", async () => {
    await add({ batchId: ids.neet, days: [4], start: "10:00", end: "11:00" }, 400);
    await add({ batchId: ids.neet, subject: "Mathematics", days: [4], start: "10:00", end: "11:00" }, 400);
    const wrong = await add({ batchId: ids.neet, subject: "Biology", days: [4], start: "10:00", end: "11:00", teacherId: ids.chemistry }, 400);
    assert.match(wrong.error, /doesn't teach Biology/);
    await add({ batchId: ids.neet, subject: "Biology", days: [4], start: "11:00", end: "10:00" }, 400);
    await add({ batchId: ids.neet, subject: "Biology", days: [], start: "10:00", end: "11:00" }, 400);
    await add({ batchId: ids.neet, subject: "Biology", days: [7], start: "10:00", end: "11:00" }, 400);
    for (const day of [null, false, "", [], {}]) {
      await add({ batchId: ids.neet, subject: "Biology", days: [day], start: "10:00", end: "11:00" }, 400);
    }
    await add({ batchId: ids.neet, subject: "Biology", days: [4], start: "10:00", end: "11:00" }, 404, "otherOwner");
  });
});

describe("teacher conflicts across batches", () => {
  test("moving a class uses the destination batch's teacher default", async () => {
    const { entry } = await add({ batchId: ids.neet, subject: "Chemistry", day: 6, start: "18:00", end: "19:00" });
    assert.equal(entry.teacher.id, ids.chemistry);
    const moved = await json(await m.entry.PATCH(req("PATCH", `/api/timetable/${entry.id}`, "owner", { batchId: ids.jee }), ctx(entry.id)), 200);
    assert.equal(moved.entry.teacher.id, "");
    await json(await m.entry.DELETE(req("DELETE", `/api/timetable/${entry.id}`, "owner"), ctx(entry.id)), 200);
  });
  test("a teacher can't be in two batches at once", async () => {
    // Physics teacher: NEET Monday 10–11. JEE Monday 10:30 with the same teacher clashes.
    const res = await add({ batchId: ids.jee, subject: "Physics", days: [1], start: "10:30", end: "11:30" }, 409);
    assert.match(res.error, /teacher already has a Physics class with NEET 11th A on Monday, 10:00 AM–11:00 AM/);
    // The same time without a teacher, or with the teacher at another time, is fine.
    await add({ batchId: ids.jee, subject: "Physics", days: [1], start: "10:30", end: "11:30", teacherId: null });
    await add({ batchId: ids.jee, subject: "Physics", days: [2], start: "10:30", end: "11:30", teacherId: ids.physics });
  });

  test("assigning the teacher later is checked too", async () => {
    const jee = await list("owner", ids.jee);
    const free = jee.find((e) => e.day === 1 && !e.teacher.id)!;
    await json(await m.entry.PATCH(req("PATCH", `/api/timetable/${free.id}`, "owner", { teacherId: ids.physics }), ctx(free.id)), 409);
    const moved = await json(await m.entry.PATCH(req("PATCH", `/api/timetable/${free.id}`, "owner", { start: "13:00", end: "14:00", teacherId: ids.physics }), ctx(free.id)), 200);
    assert.equal(moved.entry.teacher.id, ids.physics);
    await json(await m.entry.PATCH(req("PATCH", `/api/timetable/${free.id}`, "owner", { days: [1, 2] }), ctx(free.id)), 400);
  });
});

describe("students and teachers see the same timetable", () => {
  test("the student sees their batch's classes, by day and time", async () => {
    const mine = await list("student");
    assert.ok(mine.length > 0);
    assert.ok(mine.every((e) => e.batch.id === ids.neet));
    const home = await json(await m.studentHome.GET(req("GET", "/api/student/overview", "student"), {}), 200);
    assert.equal(home.week.length, mine.length);
    assert.ok(home.week.some((e: Entry) => !e.teacher.id), "a class without a teacher shows");
  });

  test("the teacher sees their own classes in every batch", async () => {
    const home = await json(await m.teacherHome.GET(req("GET", "/api/teacher/overview", "physics"), {}), 200);
    const batches = new Set(home.week.map((e: Entry) => e.batch.id));
    assert.ok(batches.has(ids.neet) && batches.has(ids.jee));
    assert.ok(home.week.every((e: Entry) => e.teacher.id === ids.physics && e.mine));
  });

  test("teachers can still add their own classes", async () => {
    const res = await add({ batchId: ids.neet, subject: "Physics", day: 6, start: "10:00", end: "11:00" }, 200, "physics");
    assert.equal(res.entry.teacher.id, ids.physics);
    await add({ batchId: ids.neet, subject: "Biology", day: 6, start: "12:00", end: "13:00" }, 403, "physics");
  });
});

describe("batches and older data", () => {
  test("the batch sums up its subject timetable; its older time-only slots are kept", async () => {
    const { batch } = await json(await m.batch.GET(req("GET", `/api/tuition/batches/${ids.neet}`, "owner"), ctx(ids.neet)), 200);
    const entries = await list("owner", ids.neet);
    assert.equal(batch.classes.classes, entries.length);
    assert.deepEqual(batch.classes.days, [...new Set(entries.map((e) => e.day))].sort());
    assert.ok(batch.classes.withoutTeacher > 0);
    assert.deepEqual(batch.schedule, [{ day: 1, start: "07:00", end: "09:00" }], "never turned into classes, never changed");
  });

  test("a subject with classes can't be removed from the batch until its classes are", async () => {
    const res = await json(await m.batch.PATCH(req("PATCH", `/api/tuition/batches/${ids.neet}`, "owner", { subjects: ["Physics", "Chemistry"] }), ctx(ids.neet)), 400);
    assert.match(res.error, /Biology still has classes/);
    for (const e of (await list("owner", ids.neet)).filter((x) => x.subject === "Biology")) {
      await json(await m.entry.DELETE(req("DELETE", `/api/timetable/${e.id}`, "owner"), ctx(e.id)), 200);
    }
    const ok = await json(await m.batch.PATCH(req("PATCH", `/api/tuition/batches/${ids.neet}`, "owner", { subjects: ["Physics", "Chemistry"] }), ctx(ids.neet)), 200);
    assert.deepEqual(ok.batch.subjects, ["Physics", "Chemistry"]);
  });

  test("removing a teacher keeps their classes, without a teacher", async () => {
    await m.Batch.updateOne({ _id: ids.neet }, { $push: { teachers: { teacherId: ids.leaving, subject: "Chemistry" } } });
    const { User } = m;
    await User.updateOne({ _id: ids.leaving }, { $set: { subjects: ["Chemistry"] } });
    const added = (await add({ batchId: ids.neet, subject: "Chemistry", days: [4], start: "15:00", end: "16:00", teacherId: ids.leaving })).entries[0];
    await json(await m.teacher.DELETE(req("DELETE", `/api/tuition/teachers/${ids.leaving}`, "owner"), ctx(ids.leaving)), 200);
    const after = (await list("owner", ids.neet)).find((e) => e.id === added.id);
    assert.ok(after, "the class stays in the timetable");
    assert.equal(after!.teacher.id, "");
  });
});
