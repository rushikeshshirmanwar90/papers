// Admin UX Step 2: academic programs, simple batch creation, student/batch
// consistency and question-bank isolation. The pure rules first, then the
// real route handlers against a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import {
  academicYearOf,
  fitProblem,
  parseAcademicYear,
  PROGRAM_INFO,
  PROGRAMS,
  programOf,
  programSubjects,
  questionBankOf,
  subjectProblem,
} from "@/lib/school";

const BASE = "http://localhost:3000";

// ─── Pure rules ────────────────────────────────────────────────────────────

describe("program definitions", () => {
  test("the six programs, their subjects and legacy tracks", () => {
    assert.deepEqual([...PROGRAMS], ["JEE", "NEET", "MHT_CET_PCM", "MHT_CET_PCB", "HSC_SCIENCE", "GENERAL"]);
    assert.deepEqual(PROGRAM_INFO.JEE.subjects, ["Physics", "Chemistry", "Mathematics"]);
    assert.deepEqual(PROGRAM_INFO.NEET.subjects, ["Physics", "Chemistry", "Biology"]);
    assert.deepEqual(PROGRAM_INFO.MHT_CET_PCM.subjects, ["Physics", "Chemistry", "Mathematics"]);
    assert.deepEqual(PROGRAM_INFO.MHT_CET_PCB.subjects, ["Physics", "Chemistry", "Biology"]);
    assert.deepEqual(PROGRAM_INFO.HSC_SCIENCE.allowed, ["Physics", "Chemistry", "Mathematics", "Biology"]);
    assert.deepEqual(PROGRAM_INFO.GENERAL.allowed, ["Physics", "Chemistry", "Mathematics", "Biology"]);
    assert.equal(PROGRAM_INFO.JEE.track, "JEE");
    assert.equal(PROGRAM_INFO.NEET.track, "NEET");
    for (const p of ["MHT_CET_PCM", "MHT_CET_PCB", "HSC_SCIENCE", "GENERAL"] as const) assert.equal(PROGRAM_INFO[p].track, "General");
  });

  test("only JEE and NEET have a question bank", () => {
    assert.equal(questionBankOf("JEE"), "JEE");
    assert.equal(questionBankOf("NEET"), "NEET");
    for (const p of ["MHT_CET_PCM", "MHT_CET_PCB", "HSC_SCIENCE", "GENERAL"] as const) assert.equal(questionBankOf(p), null, p);
    assert.equal(questionBankOf(null), null);
  });

  test("legacy records: the program comes from the track", () => {
    assert.equal(programOf({ track: "JEE" }), "JEE");
    assert.equal(programOf({ track: "NEET" }), "NEET");
    assert.equal(programOf({ track: "General" }), "GENERAL");
    assert.equal(programOf({ program: "MHT_CET_PCB", track: "General" }), "MHT_CET_PCB");
    assert.equal(programOf({}), null);
    assert.deepEqual(programSubjects(null), ["Physics", "Chemistry", "Mathematics", "Biology"], "no program: every subject, as before");
  });

  test("subjects within each program's limits", () => {
    assert.equal(subjectProblem("NEET", ["Physics", "Biology"]), null, "a subset is fine");
    assert.match(subjectProblem("JEE", ["Physics", "Biology"])!, /Biology isn't part of JEE/);
    assert.match(subjectProblem("MHT_CET_PCB", ["Mathematics"])!, /isn't part of MHT-CET PCB/);
    assert.match(subjectProblem("GENERAL", [])!, /at least one/);
    assert.equal(subjectProblem("GENERAL", ["Biology"]), null);
    // HSC Science: PCM, PCB or PCMB.
    assert.equal(subjectProblem("HSC_SCIENCE", ["Physics", "Chemistry", "Mathematics"]), null);
    assert.equal(subjectProblem("HSC_SCIENCE", ["Physics", "Chemistry", "Biology"]), null);
    assert.equal(subjectProblem("HSC_SCIENCE", ["Physics", "Chemistry", "Mathematics", "Biology"]), null);
    assert.match(subjectProblem("HSC_SCIENCE", ["Physics", "Chemistry"])!, /Mathematics or Biology/);
    assert.match(subjectProblem("HSC_SCIENCE", ["Chemistry", "Biology"])!, /Physics and Chemistry/);
  });

  test("the academic year starts in April, in Indian time", () => {
    assert.equal(academicYearOf(new Date("2026-10-30T10:00:00Z")), "2026-2027");
    assert.equal(academicYearOf(new Date("2027-02-15T10:00:00Z")), "2026-2027");
    assert.equal(academicYearOf(new Date("2027-03-31T18:29:00Z")), "2026-2027", "23:59 on 31 March in India");
    assert.equal(academicYearOf(new Date("2027-03-31T18:30:00Z")), "2027-2028", "00:00 on 1 April in India");
  });

  test("academic years are read in the usual spellings", () => {
    assert.equal(parseAcademicYear("2026-2027"), "2026-2027");
    assert.equal(parseAcademicYear("2026–2027"), "2026-2027");
    assert.equal(parseAcademicYear(" 2026 - 27 "), "2026-2027");
    assert.equal(parseAcademicYear("2099-2100"), "2099-2100");
    for (const bad of ["2026-2028", "2026", "abc", "1999-2000", "2026-26", 2026, null]) assert.equal(parseAcademicYear(bad), null, String(bad));
  });

  test("a student fits a batch of the same program and class", () => {
    const batch = { name: "NEET 11th A", program: "NEET" as const, track: "NEET" as const, standard: "11th" as const };
    assert.equal(fitProblem({ program: "NEET", standard: "11th" }, batch), null);
    assert.equal(fitProblem({ track: "NEET" }, batch), null, "a legacy student, no class yet");
    assert.match(fitProblem({ program: "JEE", standard: "11th" }, batch)!, /JEE, but NEET 11th A is for NEET/);
    assert.match(fitProblem({ program: "NEET", standard: "12th" }, batch)!, /12th, but NEET 11th A is for 11th/);
    assert.match(fitProblem({ program: "MHT_CET_PCB" }, { name: "Old", track: "General" })!, /Old is for General Tuition/, "a legacy General batch is General Tuition");
  });
});

// ─── Routes ────────────────────────────────────────────────────────────────

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [batches, batch, students, student, accept, pyq, chapters, questions, topics, answer, overview, me, auth, db] = await Promise.all([
    import("@/app/api/tuition/batches/route"),
    import("@/app/api/tuition/batches/[id]/route"),
    import("@/app/api/tuition/students/route"),
    import("@/app/api/tuition/students/[id]/route"),
    import("@/app/api/tuition/join-requests/[id]/accept/route"),
    import("@/app/api/pyq/route"),
    import("@/app/api/pyq/chapters/route"),
    import("@/app/api/pyq/questions/route"),
    import("@/app/api/pyq/topics/route"),
    import("@/app/api/pyq/answer/route"),
    import("@/app/api/student/overview/route"),
    import("@/app/api/auth/me/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    batches,
    batch,
    students,
    student,
    accept,
    pyq,
    chapters,
    questions,
    topics,
    answer,
    overview,
    me,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Question: (await import("@/models/Question")).default,
    JoinRequest: (await import("@/models/JoinRequest")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seed() {
  const { Tuition, User, Batch, Question, TestRoom, TestAttempt, auth } = m;
  const tuition = await Tuition.create({ name: "Nanded Classes" });
  const other = await Tuition.create({ name: "Other Classes" });
  ids.tuition = String(tuition._id);
  const user = (email: string, role: string | null, extra: Record<string, unknown> = {}, tid: unknown = tuition._id) =>
    User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: tid, emailVerified: true, ...extra });

  const owner = await user("owner@test.local", "tuition");
  const otherOwner = await user("other-owner@test.local", "tuition", {}, other._id);
  const teacher = await user("teacher@test.local", "teacher", { subjects: ["Physics"] });
  tokens.owner = await auth.signToken(owner);
  tokens.otherOwner = await auth.signToken(otherOwner);
  tokens.teacher = await auth.signToken(teacher);
  ids.teacher = String(teacher._id);

  // Legacy records, as older app versions saved them: a track, no program or year.
  const legacyGeneral = await Batch.create({ tuitionId: tuition._id, name: "Old General", track: "General", subjects: ["Physics", "Mathematics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const legacyJee = await Batch.create({ tuitionId: tuition._id, name: "Old JEE 12", track: "JEE", standard: "12th", subjects: ["Physics", "Chemistry", "Mathematics"] });
  ids.legacyGeneral = String(legacyGeneral._id);
  ids.legacyJee = String(legacyJee._id);
  // A JEE student already in the General batch (inconsistent, from before the rules).
  const mixed = await user("mixed@test.local", "student", { track: "JEE", standard: "11th", batchId: legacyGeneral._id });
  ids.mixed = String(mixed._id);
  const legacyJeeStudent = await user("jee12@test.local", "student", { track: "JEE", standard: "12th", batchId: legacyJee._id });
  ids.legacyJeeStudent = String(legacyJeeStudent._id);
  // Their test and attempt must stay as they are.
  const test1 = await TestRoom.create({
    tuitionId: tuition._id,
    batchId: legacyJee._id,
    teacherId: teacher._id,
    title: "Old JEE test",
    questions: [{ questionText: "q", optionA: "1", optionB: "2", optionC: "3", optionD: "4", correctAnswer: "A", answerType: "MCQ" }],
    durationMinutes: 30,
    opensAt: new Date(Date.now() - 3600_000),
  });
  const attempt = await TestAttempt.create({ testId: test1._id, tuitionId: tuition._id, batchId: legacyJee._id, studentId: legacyJeeStudent._id, answers: [], score: 4, maxScore: 4, startedAt: new Date(), submittedAt: new Date() });
  ids.attempt = String(attempt._id);
  ids.test1 = String(test1._id);

  // Students for question-bank isolation, one per program, plus legacy ones.
  for (const [key, extra] of Object.entries({
    jee: { program: "JEE", track: "JEE", standard: "11th" },
    neet: { program: "NEET", track: "NEET", standard: "11th" },
    cetPcm: { program: "MHT_CET_PCM", track: "General", standard: "11th" },
    cetPcb: { program: "MHT_CET_PCB", track: "General", standard: "11th" },
    hsc: { program: "HSC_SCIENCE", track: "General", standard: "12th" },
    general: { program: "GENERAL", track: "General", standard: "11th" },
    legacyGeneralStudent: { track: "General", standard: "11th" },
    legacyJeeOnly: { track: "JEE", standard: "11th" },
    noProgram: {},
  })) {
    const s = await user(`${key.toLowerCase()}@test.local`, "student", extra);
    tokens[key] = await auth.signToken(s);
    ids[key] = String(s._id);
  }

  // A small bank: JEE and NEET past papers, a non-PYQ, and a Foundation one.
  const paperId = new (await import("mongoose")).Types.ObjectId();
  let n = 0;
  const q = (subject: string, source: string, extra: Record<string, unknown> = {}) =>
    Question.create({
      paperId,
      questionNumber: ++n,
      subject,
      examCategory: "JEE/NEET",
      standard: "11th",
      chapter: "Kinematics",
      topic: "Projectile Motion",
      source,
      questionText: `Q${n} ${source}`,
      optionA: "1",
      optionB: "2",
      optionC: "3",
      optionD: "4",
      correctAnswer: "A",
      answerType: "MCQ",
      ...extra,
    });
  ids.jeeQ = String((await q("Physics", "JEE MAIN 2022"))._id);
  await q("Physics", "AIEEE 2005");
  ids.neetQ = String((await q("Physics", "NEET 2019"))._id);
  await q("Physics", "AIPMT 2010");
  await q("Biology", "NEET 2020", { chapter: "The Living World", topic: "" });
  await q("Physics", ""); // not a past-year question
  await q("Physics", "WBJEE 2016", { examCategory: "Foundation", standard: "9th" }); // another bank category
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
const createBatch = async (body: Record<string, unknown>, status = 200, who = "owner") => json(await m.batches.POST(req("POST", "/api/tuition/batches", who, body), {}), status);
const patchBatch = async (id: string, body: Record<string, unknown>, status = 200, who = "owner") =>
  json(await m.batch.PATCH(req("PATCH", `/api/tuition/batches/${id}`, who, body), ctx(id)), status);
const createStudent = async (body: Record<string, unknown>, status = 200) => json(await m.students.POST(req("POST", "/api/tuition/students", "owner", body), {}), status);
const patchStudent = async (id: string, body: Record<string, unknown>, status = 200, who = "owner") =>
  json(await m.student.PATCH(req("PATCH", `/api/tuition/students/${id}`, who, body), ctx(id)), status);
let emails = 0;
const newStudent = (extra: Record<string, unknown>) => ({ name: `Student ${++emails}`, email: `s${emails}@test.local`, password: "password123", ...extra });

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "academic_programs_test";
  process.env.JWT_SECRET = "academic-programs-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("creating batches", () => {
  test("program, class and name: subjects and this academic year by default", async () => {
    const { batch } = await createBatch({ program: "NEET", standard: "11th", name: "NEET 11th A" });
    assert.equal(batch.program, "NEET");
    assert.equal(batch.track, "NEET", "the legacy track is kept for older apps");
    assert.equal(batch.standard, "11th");
    assert.equal(batch.academicYear, academicYearOf());
    assert.deepEqual(batch.subjects, ["Physics", "Chemistry", "Biology"]);
    assert.deepEqual(batch.teachers, [], "teachers are optional");
    assert.deepEqual(batch.schedule, [], "timings are optional");
    assert.equal(batch.venue, "", "the classroom is optional");
    assert.equal(batch.studentCount, 0);
  });

  test("this release: new batches are JEE or NEET only", async () => {
    for (const program of ["MHT_CET_PCM", "MHT_CET_PCB", "HSC_SCIENCE", "GENERAL"]) {
      const res = await createBatch({ program, standard: "12th", name: `${program} 12th A` }, 400);
      assert.match(res.error, /isn't offered yet\. Choose JEE or NEET/);
    }
    const jee = (await createBatch({ program: "JEE", standard: "12th", name: "JEE 12th B", academicYear: "2026–27" })).batch;
    assert.equal(jee.academicYear, "2026-2027");
    // An existing MHT-CET batch (made before this release) is kept and stays editable.
    const cet = await m.Batch.create({
      tuitionId: ids.tuition,
      name: "MHT-CET PCB 12th A",
      program: "MHT_CET_PCB",
      track: "General",
      standard: "12th",
      academicYear: "2026-2027",
      subjects: ["Physics", "Chemistry", "Biology"],
    });
    ids.cetBatch = String(cet._id);
  });

  test("only 11th or 12th, valid subjects and years", async () => {
    await createBatch({ program: "JEE", name: "No class" }, 400);
    await createBatch({ program: "JEE", standard: "10th", name: "Tenth" }, 400);
    await createBatch({ program: "JEE", standard: null, name: "Both" }, 400);
    await createBatch({ program: "JEE", standard: "11th", name: "Bio", subjects: ["Biology"] }, 400);
    await createBatch({ program: "JEE", standard: "11th", name: "Bad year", academicYear: "2026-2028" }, 400);
    await createBatch({ program: "MBBS", standard: "11th", name: "Unknown" }, 400);
    await createBatch({ program: "JEE", track: "NEET", standard: "11th", name: "Mismatch" }, 400);
    await createBatch({ program: "JEE", standard: "11th", name: "" }, 400);
  });

  test("this app sends the program with its matching legacy track", async () => {
    const { batch } = await createBatch({ program: "NEET", track: "NEET", standard: "12th", name: "NEET 12th A" });
    assert.equal(batch.program, "NEET");
    const { student } = await createStudent(newStudent({ program: "NEET", track: "NEET", standard: "12th", batchId: batch.id }));
    assert.equal(student.program, "NEET");
    assert.equal(student.batch.id, batch.id);
  });

  test("older app versions still create batches with a track", async () => {
    const { batch } = await createBatch({ track: "JEE", standard: null, name: "Old app JEE", subjects: ["Physics"] });
    assert.equal(batch.program, "JEE");
    assert.equal(batch.standard, null, "older apps may still create 11th & 12th batches");
    assert.equal(batch.academicYear, null);
  });

  test("teachers, a classroom and timings can be given at once", async () => {
    const { batch } = await createBatch({
      program: "JEE",
      standard: "12th",
      name: "JEE 12th A",
      venue: "Room 2",
      schedule: [{ day: 1, start: "07:00", end: "09:00" }],
      teachers: [{ teacherId: ids.teacher, subject: "Physics" }],
    });
    assert.equal(batch.venue, "Room 2");
    assert.equal(batch.teachers[0].subject, "Physics");
    assert.equal(batch.schedule.length, 1);
    ids.jeeBatch = batch.id;
  });
});

describe("legacy batches and editing", () => {
  test("legacy batches list with a program from their track and no year", async () => {
    const { batches } = await json(await m.batches.GET(req("GET", "/api/tuition/batches", "owner"), {}), 200);
    const general = batches.find((b: { id: string }) => b.id === ids.legacyGeneral);
    assert.equal(general.program, "GENERAL");
    assert.equal(general.track, "General");
    assert.equal(general.academicYear, null);
    assert.equal(general.teachers.length, 1, "teacher assignments are kept");
    assert.equal(general.studentCount, 1, "student assignments are kept");
  });

  test("an older app editing an MHT-CET batch (sending track General) keeps its program", async () => {
    const { batch } = await patchBatch(ids.cetBatch, { name: "MHT-CET PCB 12th Morning", track: "General" });
    assert.equal(batch.program, "MHT_CET_PCB");
    assert.deepEqual(batch.subjects, ["Physics", "Chemistry", "Biology"]);
  });

  test("editing keeps teachers and adds the year to a legacy batch", async () => {
    const { batch } = await patchBatch(ids.legacyJee, { program: "JEE", academicYear: "2026-2027", venue: "Hall" });
    assert.equal(batch.academicYear, "2026-2027");
    assert.equal(batch.standard, "12th");
    assert.equal(batch.studentCount, 1);
    const { batch: again } = await patchBatch(ids.jeeBatch, { name: "JEE 12th A (new)" });
    assert.equal(again.teachers.length, 1, "editing the name keeps the teachers");
  });

  test("the program or class can't change while students wouldn't fit", async () => {
    const res = await patchBatch(ids.legacyJee, { program: "NEET" }, 400);
    assert.match(res.error, /jee12/);
    await patchBatch(ids.legacyJee, { program: "JEE", standard: "11th" }, 400);
    const stored = await m.Batch.findById(ids.legacyJee).lean<{ track: string; standard: string }>();
    assert.equal(stored!.track, "JEE");
    assert.equal(stored!.standard, "12th");
  });

  test("an empty batch can change between offered programs; its subjects follow", async () => {
    const { batch } = await patchBatch(ids.jeeBatch, { program: "NEET" });
    assert.equal(batch.program, "NEET");
    assert.deepEqual(batch.subjects, ["Physics", "Chemistry", "Biology"]);
    assert.equal(batch.teachers.length, 1, "Physics is still a subject, so its teacher stays");
    await patchBatch(ids.jeeBatch, { program: "MHT_CET_PCM" }, 400); // not offered
    await patchBatch(ids.jeeBatch, { program: "JEE" });
  });

  test("existing tests and attempts are untouched", async () => {
    const t = await m.TestRoom.findById(ids.test1).lean<{ batchId: unknown; title: string }>();
    assert.equal(String(t!.batchId), ids.legacyJee);
    assert.equal(t!.title, "Old JEE test");
    const a = await m.TestAttempt.findById(ids.attempt).lean<{ score: number; batchId: unknown; studentId: unknown }>();
    assert.equal(a!.score, 4);
    assert.equal(String(a!.batchId), ids.legacyJee);
    assert.equal(String(a!.studentId), ids.legacyJeeStudent);
  });

  test("another tuition can't see or change these batches", async () => {
    await json(await m.batch.GET(req("GET", `/api/tuition/batches/${ids.cetBatch}`, "otherOwner"), ctx(ids.cetBatch)), 404);
    await patchBatch(ids.cetBatch, { name: "Mine now" }, 404, "otherOwner");
    await patchBatch(ids.cetBatch, { name: "Teacher" }, 403, "teacher");
  });
});

describe("students and batches stay consistent", () => {
  test("new students: JEE or NEET, with their class", async () => {
    const res = await createStudent(newStudent({ program: "MHT_CET_PCB", standard: "12th", batchId: ids.cetBatch }), 400);
    assert.match(res.error, /isn't offered yet/);
    const noClass = await createStudent(newStudent({ program: "JEE" }), 400);
    assert.match(noClass.error, /class: 11th or 12th/);
    const { student } = await createStudent(newStudent({ program: "JEE", standard: "12th", batchId: ids.legacyJee }));
    assert.equal(student.program, "JEE");
    assert.equal(student.standard, "12th");
    assert.equal(student.batch.id, ids.legacyJee);
    assert.equal(student.active, true, "account status: can log in");
    // An existing MHT-CET student (from before this release) in the MHT-CET batch.
    const cet = await m.User.create({ email: "cet-old@test.local", name: "cet-old", passwordHash: "x", role: "student", tuitionId: ids.tuition, emailVerified: true, program: "MHT_CET_PCB", track: "General", standard: "12th", batchId: ids.cetBatch });
    ids.cetStudent = String(cet._id);
  });

  test("another program's or class's batch is refused", async () => {
    const res = await createStudent(newStudent({ program: "NEET", standard: "12th", batchId: ids.cetBatch }), 400);
    assert.match(res.error, /is for MHT-CET PCB/);
    await createStudent(newStudent({ program: "JEE", standard: "11th", batchId: ids.legacyJee }), 400); // a 12th batch
    await createStudent(newStudent({ standard: "12th" }), 400); // no program
  });

  test("older app versions enroll with a track", async () => {
    const { student } = await createStudent(newStudent({ track: "NEET", standard: "11th" }));
    assert.equal(student.program, "NEET");
  });

  test("moving a student checks the new batch; nothing changes when refused", async () => {
    const res = await patchStudent(ids.cetStudent, { batchId: ids.legacyJee }, 400);
    assert.match(res.error, /MHT-CET PCB/);
    const stored = await m.User.findById(ids.cetStudent).lean<{ batchId: unknown }>();
    assert.equal(String(stored!.batchId), ids.cetBatch);
    await patchStudent(ids.cetStudent, { standard: "11th" }, 400); // their batch is 12th
    const { student } = await patchStudent(ids.cetStudent, { batchId: null, standard: "11th" });
    assert.equal(student.batch, null);
    await patchStudent(ids.cetStudent, { batchId: ids.cetBatch, standard: "12th" });
  });

  test("an older app's track keeps the student's program; legacy mismatches aren't touched", async () => {
    const { student } = await patchStudent(ids.cetStudent, { track: "General", name: "Renamed" });
    assert.equal(student.program, "MHT_CET_PCB");
    const kept = await patchStudent(ids.cetStudent, { program: "MHT_CET_PCB", phone: "1" });
    assert.equal(kept.student.program, "MHT_CET_PCB", "keeping a program that's no longer offered is fine");
    await patchStudent(ids.mixed, { program: "MHT_CET_PCM" }, 400); // moving to it isn't
    // A JEE student already in the General batch: editing their phone is fine.
    const mixed = await patchStudent(ids.mixed, { phone: "98200 00000" });
    assert.equal(mixed.student.batch.id, ids.legacyGeneral);
  });

  test("another tuition's batch can't be used", async () => {
    const res = await createStudent(newStudent({ program: "JEE", standard: "11th", batchId: "0123456789abcdef01234567" }), 400);
    assert.match(res.error, /Pick one of your batches/);
    await patchStudent(ids.cetStudent, { name: "x" }, 404, "otherOwner");
  });

  test("accepting a join request as a student checks the batch", async () => {
    const person = await m.User.create({ email: "joiner@test.local", name: "Joiner", passwordHash: "x", role: null, tuitionId: null, emailVerified: true });
    const request = await m.JoinRequest.create({ userId: person._id, tuitionId: ids.tuition });
    const accept = async (body: Record<string, unknown>, status: number) =>
      json(await m.accept.POST(req("POST", `/api/tuition/join-requests/${request._id}/accept`, "owner", body), ctx(String(request._id))), status);
    await accept({ as: "student", program: "NEET", standard: "12th", batchId: ids.cetBatch }, 400);
    await accept({ as: "student", program: "MHT_CET_PCB", standard: "12th", batchId: ids.cetBatch }, 400); // not offered
    await accept({ as: "student", program: "JEE", batchId: ids.legacyJee }, 400); // no class
    assert.equal((await m.User.findById(person._id).lean<{ tuitionId: unknown }>())!.tuitionId, null, "nothing saved when refused");
    await accept({ as: "student", program: "JEE", standard: "12th", batchId: ids.legacyJee }, 200);
    const joined = await m.User.findById(person._id).lean<{ program: string; track: string; role: string; standard: string; batchId: unknown }>();
    assert.equal(joined!.program, "JEE");
    assert.equal(joined!.track, "JEE");
    assert.equal(joined!.standard, "12th");
    assert.equal(String(joined!.batchId), ids.legacyJee);
    assert.equal(joined!.role, "student");
  });
});

describe("batch timings", () => {
  test("one time for several days, different times on other days", async () => {
    const schedule = [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "16:00", end: "18:00" })).concat([{ day: 6, start: "09:00", end: "11:00" }]);
    const { batch } = await patchBatch(ids.jeeBatch, { schedule });
    assert.equal(batch.schedule.length, 7);
    assert.deepEqual(batch.schedule.filter((s: { day: number }) => s.day === 6).map((s: { start: string }) => s.start), ["09:00", "16:00"], "sorted by time");
    assert.equal(batch.weeklyMinutes, 7 * 120);
  });

  test("overlapping classes are refused; back to back is fine; nothing saved when refused", async () => {
    const res = await patchBatch(ids.jeeBatch, { schedule: [{ day: 1, start: "16:00", end: "18:00" }, { day: 1, start: "17:30", end: "19:00" }] }, 400);
    assert.match(res.error, /overlap on Monday/);
    await patchBatch(ids.jeeBatch, { schedule: [{ day: 2, start: "16:00", end: "18:00" }, { day: 2, start: "16:00", end: "18:00" }] }, 400); // the same slot twice
    await patchBatch(ids.jeeBatch, { schedule: [{ day: 1, start: "18:00", end: "17:00" }] }, 400); // ends before it starts
    const stored = await m.Batch.findById(ids.jeeBatch).lean<{ schedule: unknown[] }>();
    assert.equal(stored!.schedule.length, 7);
    const { batch } = await patchBatch(ids.jeeBatch, { schedule: [{ day: 1, start: "16:00", end: "17:00" }, { day: 1, start: "17:00", end: "18:00" }] });
    assert.equal(batch.schedule.length, 2);
  });

  test("an existing schedule is kept when other details change", async () => {
    // Saved before overlaps were checked; editing the name doesn't touch it.
    const old = await m.Batch.create({ tuitionId: ids.tuition, name: "Old overlap", track: "JEE", standard: "11th", subjects: ["Physics"], schedule: [{ day: 3, start: "10:00", end: "12:00" }, { day: 3, start: "11:00", end: "13:00" }] });
    const { batch } = await patchBatch(String(old._id), { name: "Old overlap (renamed)", program: "JEE" });
    assert.equal(batch.schedule.length, 2);
  });
});

describe("question-bank isolation", () => {
  type Q = { _id: string; source: string; subject: string };
  const listed = async (who: string, subject: string) => (await json(await m.pyq.GET(req("GET", `/api/pyq?subject=${subject}`, who), {}), 200)) as { questions: Q[]; available: boolean };

  test("JEE students get only JEE past papers", async () => {
    const res = await listed("jee", "Physics");
    assert.equal(res.available, true);
    assert.deepEqual(res.questions.map((q) => q.source).sort(), ["AIEEE 2005", "JEE MAIN 2022"]);
    await json(await m.pyq.GET(req("GET", "/api/pyq?subject=Biology", "jee"), {}), 400);
  });

  test("NEET students get only NEET past papers", async () => {
    assert.deepEqual((await listed("neet", "Physics")).questions.map((q) => q.source).sort(), ["AIPMT 2010", "NEET 2019"]);
    assert.deepEqual((await listed("neet", "Biology")).questions.map((q) => q.source), ["NEET 2020"]);
  });

  test("legacy JEE students (track only) practise as before", async () => {
    assert.deepEqual((await listed("legacyJeeOnly", "Physics")).questions.map((q) => q.source).sort(), ["AIEEE 2005", "JEE MAIN 2022"]);
  });

  for (const who of ["cetPcm", "cetPcb", "hsc", "general", "legacyGeneralStudent", "noProgram"]) {
    test(`${who}: no questions from any bank, and a clear unavailable state`, async () => {
      const res = await listed(who, "Physics");
      assert.equal(res.available, false);
      assert.deepEqual(res.questions, []);

      const ch = await json(await m.chapters.GET(req("GET", "/api/pyq/chapters?subject=Physics", who), {}), 200);
      assert.equal(ch.available, false);
      assert.deepEqual(ch.chapters, []);

      const tree = await json(await m.topics.GET(req("GET", "/api/pyq/topics?subject=Physics", who), {}), 200);
      assert.equal(tree.available, false);
      assert.deepEqual(tree.chapters, []);
      assert.equal(tree.summary.questions, 0);

      const page = await json(
        await m.questions.GET(req("GET", "/api/pyq/questions?subject=Physics&standard=11th&chapter=Kinematics&topic=Projectile%20Motion", who), {}),
        200
      );
      assert.equal(page.available, false);
      assert.deepEqual(page.questions, []);

      // Not even a known JEE or NEET question id can be checked.
      await json(await m.answer.POST(req("POST", "/api/pyq/answer", who, { questionId: ids.jeeQ, selected: "A" }), {}), 404);
      await json(await m.answer.POST(req("POST", "/api/pyq/answer", who, { questionId: ids.neetQ, selected: "A" }), {}), 404);
    });
  }

  test("answers can be checked only within the student's own bank", async () => {
    await json(await m.answer.POST(req("POST", "/api/pyq/answer", "jee", { questionId: ids.jeeQ, selected: "A" }), {}), 200);
    await json(await m.answer.POST(req("POST", "/api/pyq/answer", "jee", { questionId: ids.neetQ, selected: "A" }), {}), 404);
    await json(await m.answer.POST(req("POST", "/api/pyq/answer", "neet", { questionId: ids.jeeQ, selected: "A" }), {}), 404);
  });

  test("subjects outside the program are refused; teachers get no practice bank", async () => {
    await json(await m.topics.GET(req("GET", "/api/pyq/topics?subject=Mathematics", "cetPcb"), {}), 400);
    const teacher = await listed("teacher", "Physics");
    assert.equal(teacher.available, false, "teachers have no program, so no 'any exam' fallback");
    assert.deepEqual(teacher.questions, []);
  });

  test("students see their program and its subjects", async () => {
    const meCet = await json(await m.me.GET(req("GET", "/api/auth/me", "cetPcb"), {}), 200);
    assert.equal(meCet.user.program, "MHT_CET_PCB");
    const meLegacy = await json(await m.me.GET(req("GET", "/api/auth/me", "legacyGeneralStudent"), {}), 200);
    assert.equal(meLegacy.user.program, "GENERAL");
    const home = await json(await m.overview.GET(req("GET", "/api/student/overview", "cetPcb"), {}), 200);
    assert.deepEqual(home.subjects, ["Physics", "Chemistry", "Biology"]);
  });
});
