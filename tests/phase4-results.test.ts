// Phase 4: test results and performance analytics, server side — summary, rankings and ties,
// question and topic statistics, weak topics, the student's own result and its release rule, and
// isolation. Runs the real route handlers against a throwaway in-memory MongoDB; attempts are stored
// with the same scoring (lib/marking) that finalize() uses.
// Run with: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const MIN = 60_000;
const HOUR = 60 * MIN;

let mongod: MongoMemoryReplSet;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [testRoute, resultsRoute, studentRoute, monitorRoute, analysisRoute, startRoute, answersRoute, submitRoute, auth, db, results, marking] = await Promise.all([
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/results/route"),
    import("@/app/api/tests/[id]/results/[studentId]/route"),
    import("@/app/api/tests/[id]/monitor/route"),
    import("@/app/api/analysis/test/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/answers/route"),
    import("@/app/api/tests/[id]/submit/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
    import("@/lib/test-results"),
    import("@/lib/marking"),
  ]);
  return {
    testRoute,
    resultsRoute,
    studentRoute,
    monitorRoute,
    analysisRoute,
    startRoute,
    answersRoute,
    submitRoute,
    auth,
    db,
    results,
    marking,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Question: (await import("@/models/Question")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const names: Record<string, string> = {};
let bankDigest = "";

async function digest(collection: typeof m.Question.collection) {
  const docs = (await collection.find({}).sort({ _id: 1 }).toArray()).map((doc) => { delete doc.controlRevision; delete doc.updatedAt; return doc; }); // the room lock counter ticks on every locked read
  return `${docs.length}:${createHash("sha256").update(JSON.stringify(docs)).digest("hex")}`;
}
const bank = () => digest(m.Question.collection);
const attemptsDigest = () => digest(m.TestAttempt.collection);
const roomsDigest = () => digest(m.TestRoom.collection);

async function seed() {
  const { Tuition, User, Batch, Question, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const other = await Tuition.create({ name: "Tuition B" });
  const user = (email: string, role: string | null, t: { _id: unknown } | null = tuition) =>
    User.create({ email, name: email.split("@")[0], passwordHash: "x", role, tuitionId: t?._id ?? null, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const outsider = await user("outsider@test.local", "teacher"); // same tuition, not teaching the batch
  const strange = await user("strange@test.local", "teacher", other); // another tuition
  const admin = await user("admin@test.local", "tuition");
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const batch2 = await Batch.create({ tuitionId: tuition._id, name: "12 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const otherBatch = await Batch.create({ tuitionId: other._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [] });
  for (const [key, batchDoc, t] of [
    ["s1", batch, tuition],
    ["s2", batch, tuition],
    ["s3", batch, tuition],
    ["s6", batch, tuition], // never starts
    ["s7", batch, tuition],
    ["s4", batch2, tuition], // another batch of the same tuition
    ["s5", otherBatch, other], // another tuition
  ] as const) {
    const u = await user(`${key}@test.local`, "student", t);
    await User.updateOne({ _id: u._id }, { batchId: batchDoc._id });
    tokens[key] = await auth.signToken((await User.findById(u._id))!);
    ids[key] = String(u._id);
    names[key] = u.name;
  }
  tokens.teacher = await auth.signToken(teacher);
  tokens.outsider = await auth.signToken(outsider);
  tokens.strange = await auth.signToken(strange);
  tokens.admin = await auth.signToken(admin);
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);
  ids.tuition = String(tuition._id);

  await Question.insertMany(
    ["One", "Two"].map((word, i) => ({
      paperId: tuition._id,
      questionNumber: i + 1,
      examCategory: "JEE/NEET",
      subject: "Physics",
      standard: "11th",
      chapter: "Kinematics",
      topic: "Motion",
      questionText: `Bank question ${word}`,
      optionA: "1",
      optionB: "2",
      optionC: "3",
      optionD: "4",
      correctAnswer: "AB"[i],
      explanation: `Bank solution ${word}`,
    }))
  );
  bankDigest = await bank();
}

type Q = { subject?: string; chapter?: string; topic?: string; correctAnswer: string; answerType?: string };
const question = (n: number, q: Q) => ({
  subject: q.subject ?? "Physics",
  chapter: q.chapter ?? "",
  topic: q.topic ?? "",
  questionText: `Question ${n} with $x^2$`,
  optionA: "1",
  optionB: "2",
  optionC: "3",
  optionD: "4",
  answerType: q.answerType ?? "MCQ",
  correctAnswer: q.correctAnswer,
  explanation: `Solution ${n}`,
  diagramUrls: [],
});

// Q0 A, Q1 B (Electric Field) · Q2 C, Q3 9.8 numerical (Ohm's Law) · Q4 A (no chapter or topic).
const STANDARD: Q[] = [
  { chapter: "Electrostatics", topic: "Electric Field", correctAnswer: "A" },
  { chapter: "Electrostatics", topic: "Electric Field", correctAnswer: "B" },
  { chapter: "Current Electricity", topic: "Ohm's Law", correctAnswer: "C" },
  { chapter: "Current Electricity", topic: "Ohm's Law", correctAnswer: "9.8", answerType: "Numerical" },
  { correctAnswer: "A" },
];

async function room(over: { opensAt?: Date; closesAt?: Date; durationMinutes?: number; questions?: Q[]; marksPerQuestion?: number; negativeMarks?: number; batchId?: string } = {}) {
  const doc = await m.TestRoom.create({
    tuitionId: ids.tuition,
    batchId: over.batchId ?? ids.batch,
    teacherId: ids.teacher,
    title: "Results test",
    subject: "Physics",
    questions: (over.questions ?? STANDARD).map((q, i) => question(i, q)),
    marksPerQuestion: over.marksPerQuestion ?? 4,
    negativeMarks: over.negativeMarks ?? 1,
    durationMinutes: over.durationMinutes ?? 60,
    opensAt: over.opensAt ?? new Date(Date.now() - 3 * HOUR),
    closesAt: over.closesAt ?? new Date(Date.now() - 30 * MIN),
  });
  return String(doc._id);
}

/** Stores a finished attempt as finalize() would: the answers marked by lib/marking. */
async function attempt(testId: string, who: string, given: Record<number, string | null>, o: { startedAgoMin?: number; takenSeconds?: number; auto?: boolean; violation?: boolean } = {}) {
  const test = (await m.TestRoom.findById(testId))!;
  const result = m.marking.scoreAnswers(test.questions, new Map(Object.entries(given).map(([k, v]) => [Number(k), v])), test.marksPerQuestion, test.negativeMarks);
  const startedAt = new Date(Date.now() - (o.startedAgoMin ?? 150) * MIN);
  const takenSeconds = o.takenSeconds ?? 600;
  return m.TestAttempt.create({
    tuitionId: ids.tuition,
    testId,
    batchId: test.batchId,
    studentId: ids[who],
    startedAt,
    answers: result.answers,
    score: result.score,
    maxScore: result.maxScore,
    correctCount: result.correctCount,
    wrongCount: result.wrongCount,
    skippedCount: result.skippedCount,
    // An auto-submitted attempt is stamped with exactly its deadline (see stateOf in lib/test-monitor.ts).
    submittedAt: new Date(startedAt.getTime() + (o.auto ? test.durationMinutes * MIN : takenSeconds * 1000)),
    timeTakenSeconds: o.auto ? test.durationMinutes * 60 : takenSeconds,
    endedReason: o.violation ? "violation" : null,
  });
}

/** The reference batch: 20 marks, four attempted, one who never started. */
async function standardTest() {
  const id = await room();
  await attempt(id, "s1", { 0: "A", 1: "B", 2: "C", 3: "9.80", 4: "A" }, { takenSeconds: 600 }); // 20
  await attempt(id, "s2", { 0: "A", 1: "B", 2: "C", 3: "1" }, { auto: true }); // 3 right, 1 wrong, 1 skipped = 11
  await attempt(id, "s7", { 0: "A", 1: "B", 2: "C", 3: "0" }, { takenSeconds: 300 }); // 11, quicker than s2
  await attempt(id, "s3", { 0: "B", 1: "A" }, { violation: true, takenSeconds: 120 }); // 2 wrong = −2
  return id;
}

function req(method: string, path: string, who?: string, body?: unknown) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status?: number) {
  const body = await res.json();
  if (status !== undefined) assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const results = async (id: string, who = "teacher", status = 200): Promise<any> => json(await m.resultsRoute.GET(req("GET", `/api/tests/${id}/results`, who), { params: { id } }), status);
const resultsRes = (id: string, who: string) => m.resultsRoute.GET(req("GET", `/api/tests/${id}/results`, who), { params: { id } });
const detailRes = (id: string, studentId: string, who: string) => m.studentRoute.GET(req("GET", `/api/tests/${id}/results/${studentId}`, who), { params: { id, studentId } });
const detail = async (id: string, who: string, student: string, status = 200): Promise<any> => json(await detailRes(id, ids[student] ?? student, who), status);
const own = async (id: string, who: string, status = 200): Promise<any> => json(await m.testRoute.GET(req("GET", `/api/tests/${id}`, who), { params: { id } }), status);
const row = (r: any, who: string) => r.rankings.find((x: any) => x.student.id === ids[who]);

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase4_results";
  process.env.JWT_SECRET = "phase4-test-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await m.TestAttempt.init();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("summary", () => {
  test("highest, lowest, averages and participation agree with the stored scores; non-attempted students are left out of averages", async () => {
    const r = await results(await standardTest());
    assert.deepEqual(r.summary, {
      total: 5,
      attempted: 4,
      notAttempted: 1,
      inProgress: 0,
      former: 0,
      submissionRate: 80,
      normal: 2,
      autoSubmitted: 1,
      violations: 1,
      highest: 20,
      lowest: -2,
      averageScore: 10, // (20 + 11 + 11 − 2) / 4, not / 5
      averagePercentage: 50, // (100 + 55 + 55 − 10) / 4
      averageAccuracy: 62.5, // (100 + 75 + 75 + 0) / 4
    });
    assert.deepEqual(r.notAttempted.map((s: any) => s.id), [ids.s6]);
  });

  test("nobody attempted: no NaN, averages are null and the submission rate is 0", async () => {
    const r = await results(await room());
    assert.deepEqual(r.rankings, []);
    assert.equal(r.summary.attempted, 0);
    assert.equal(r.summary.submissionRate, 0);
    for (const k of ["highest", "lowest", "averageScore", "averagePercentage", "averageAccuracy"]) assert.equal(r.summary[k], null, k);
    assert.ok(r.questions.every((q: any) => q.correctRate === null && q.skipRate === null && q.answered === 0));
    assert.ok(!JSON.stringify(r).includes("NaN"));
  });

  test("an attempt that answered nothing scores 0, counts as attempted, and has no accuracy (so it is left out of that average only)", async () => {
    const id = await room();
    await attempt(id, "s1", { 0: "A", 1: "B", 2: "C", 3: "9.8", 4: "A" });
    await attempt(id, "s2", {});
    const r = await results(id);
    assert.equal(row(r, "s2").score, 0);
    assert.equal(row(r, "s2").accuracy, null);
    assert.equal(row(r, "s2").unanswered, 5);
    assert.equal(r.summary.averageAccuracy, 100);
    assert.equal(r.summary.averageScore, 10);
  });
});

describe("rankings", () => {
  test("ranked by score with ties sharing a rank, then the quicker attempt; negative scores rank last", async () => {
    const r = await results(await standardTest());
    assert.deepEqual(
      r.rankings.map((x: any) => [x.student.id, x.rank, x.score]),
      [
        [ids.s1, 1, 20],
        [ids.s7, 2, 11], // same score as s2, quicker
        [ids.s2, 2, 11],
        [ids.s3, 4, -2], // the next rank skips the tie
      ]
    );
    assert.equal(row(r, "s3").percentage, -10);
  });

  test("states distinguish submitted, auto-submitted and violation; bands use the 70% / 40% marks; the unranked are never ranked", async () => {
    const r = await results(await standardTest());
    assert.deepEqual(
      Object.fromEntries(r.rankings.map((x: any) => [x.student.id, [x.state, x.band]])),
      { [ids.s1]: ["submitted", "top"], [ids.s7]: ["submitted", "average"], [ids.s2]: ["auto-submitted", "average"], [ids.s3]: ["violation", "needs-improvement"] }
    );
    assert.ok(!r.rankings.some((x: any) => x.student.id === ids.s6));
  });

  test("an unsubmitted attempt whose time is up is scored when the results are read, then ranked as auto-submitted", async () => {
    const id = await room();
    await m.TestAttempt.create({ tuitionId: ids.tuition, testId: id, batchId: ids.batch, studentId: ids.s1, startedAt: new Date(Date.now() - 2 * HOUR), answers: [{ index: 0, selected: "A", correct: null }], maxScore: 20 });
    const r = await results(id);
    assert.equal(row(r, "s1").state, "auto-submitted");
    assert.equal(row(r, "s1").score, 4);
    assert.equal(r.summary.autoSubmitted, 1);
  });
});

describe("questions", () => {
  test("per-question counts, rates and the option distribution come from the saved attempts", async () => {
    const r = await results(await standardTest());
    const [q0, , q2, , q4] = r.questions;
    assert.deepEqual([q0.attempts, q0.answered, q0.correct, q0.incorrect, q0.unanswered, q0.correctRate, q0.incorrectRate, q0.skipRate], [4, 4, 3, 1, 0, 75, 25, 0]);
    assert.deepEqual(q0.options, { A: 3, B: 1, C: 0, D: 0 });
    assert.deepEqual([q2.correct, q2.incorrect, q2.unanswered, q2.correctRate, q2.skipRate], [3, 0, 1, 100, 25]);
    assert.deepEqual([q4.correct, q4.unanswered, q4.skipRate], [1, 3, 75]);
  });

  test("numerical questions are counted by the stored verdict and have no option distribution", async () => {
    const r = await results(await standardTest());
    const q3 = r.questions[3];
    assert.equal(q3.answerType, "Numerical");
    assert.equal(q3.options, null);
    assert.deepEqual([q3.correct, q3.incorrect, q3.unanswered, q3.correctRate], [1, 2, 1, 33.3]); // "9.80" matches 9.8; "1" and "0" don't
  });

  test("highlights: most correct, most incorrect and most skipped by head count, ties to the higher rate then the earlier question", async () => {
    const r = await results(await standardTest());
    assert.deepEqual(r.highlights, { mostCorrect: [2, 0, 1], mostIncorrect: [3, 0, 1], mostSkipped: [4, 2, 3] });
  });

  test("a question without an answer key is not marked and says so; a bonus question has no option distribution", async () => {
    const id = await room({ questions: [{ correctAnswer: "" }, { correctAnswer: "bonus" }] });
    await attempt(id, "s1", { 0: "A" });
    const r = await results(id);
    assert.equal(r.questions[0].hasKey, false);
    assert.equal(r.questions[0].correct + r.questions[0].incorrect, 0);
    assert.equal(r.questions[1].bonus, true);
    assert.equal(r.questions[1].options, null);
    assert.equal(r.questions[1].correct, 1);
  });
});

describe("topics", () => {
  test("accuracy, marks and denominators per topic; missing metadata goes to Unclassified", async () => {
    const r = await results(await standardTest());
    const [field, ohm, none] = [r.topics.find((t: any) => t.topic === "Electric Field"), r.topics.find((t: any) => t.topic === "Ohm's Law"), r.topics.find((t: any) => !t.classified)];
    assert.deepEqual([field.questions, field.possible, field.attempted, field.correct, field.incorrect, field.accuracy, field.marks, field.maxMarks], [2, 8, 8, 6, 2, 75, 22, 32]);
    assert.deepEqual([ohm.attempted, ohm.correct, ohm.incorrect, ohm.unanswered, ohm.accuracy], [6, 4, 2, 2, 66.7]);
    assert.equal(none.label, "Unclassified");
    assert.equal(none.level, "not-enough"); // one question, answered once
    assert.equal(r.topics.at(-1).label, "Unclassified");
    assert.deepEqual(r.weakTopics, []);
  });

  test("the minimum sample: one question, or too few answers, is never called weak", () => {
    const { topicPerformance, weakTopics } = m.results;
    const test = { questions: [{ subject: "Physics", chapter: "C", topic: "T", correctAnswer: "A", answerType: "MCQ" }, { subject: "Physics", chapter: "C", topic: "T", correctAnswer: "A", answerType: "MCQ" }, { subject: "Physics", chapter: "D", topic: "U", correctAnswer: "A", answerType: "MCQ" }], marksPerQuestion: 4, negativeMarks: 1 } as never;
    const wrong = (...indexes: number[]) => ({ answers: indexes.map((index) => ({ index, selected: "B", correct: false })), studentId: "x" }) as never;
    // Topic U has one question, every student wrong: not enough.
    const one = topicPerformance(test, [wrong(2), wrong(2), wrong(2), wrong(2), wrong(2), wrong(2)], 5);
    assert.equal(one.find((t: any) => t.topic === "U")!.level, "not-enough");
    // Topic T: both questions wrong but only 4 answers in all (< 5 for a batch).
    const few = topicPerformance(test, [wrong(0, 1), wrong(0, 1)], 5);
    assert.equal(few.find((t: any) => t.topic === "T")!.level, "not-enough");
    // Six students wrong on both questions: weak, with a recommendation.
    const many = topicPerformance(test, Array.from({ length: 6 }, () => wrong(0, 1)), 5);
    const weak = weakTopics(many);
    assert.deepEqual(weak.map((t: any) => [t.label, t.accuracy, t.attempted]), [["T", 0, 12]]);
    assert.match(weak[0].recommendation, /^Revise T concepts and practise more questions from this topic\.$/);
    // Right on one question and wrong on the other of the same topic: 50%, average.
    const mixed = topicPerformance(test, Array.from({ length: 6 }, () => ({ answers: [{ index: 0, selected: "A", correct: true }, { index: 1, selected: "B", correct: false }], studentId: "x" }) as never), 5);
    assert.equal(mixed.find((t: any) => t.topic === "T")!.level, "average");
  });

  test("marks use the test's own positive and negative marking", () => {
    const test = { questions: [{ subject: "Physics", chapter: "C", topic: "T", correctAnswer: "A", answerType: "MCQ" }, { subject: "Physics", chapter: "C", topic: "T", correctAnswer: "A", answerType: "MCQ" }], marksPerQuestion: 2, negativeMarks: 0.5 } as never;
    const [t] = m.results.topicPerformance(test, [{ answers: [{ index: 0, selected: "A", correct: true }, { index: 1, selected: "B", correct: false }] } as never], 2);
    assert.deepEqual([t.marks, t.maxMarks], [1.5, 4]);
  });

  test("biology questions are filed under the school subject", async () => {
    const id = await room({ questions: [{ subject: "Botany", chapter: "Cell", topic: "Nucleus", correctAnswer: "A" }] });
    await attempt(id, "s1", { 0: "A" });
    assert.equal((await results(id)).topics[0].subject, "Biology");
  });
});

describe("one student's performance (teacher)", () => {
  test("headline figures, rank and the question-by-question breakdown with marks, solutions and metadata", async () => {
    const id = await standardTest();
    const d = await detail(id, "teacher", "s3");
    assert.equal(d.student.name, names.s3);
    assert.deepEqual([d.state, d.rank, d.ranked, d.score, d.maxScore, d.percentage, d.accuracy, d.correct, d.incorrect, d.unanswered, d.negativeDeducted, d.timeTakenSeconds], ["violation", 4, 4, -2, 20, -10, 0, 0, 2, 3, 2, 120]);
    assert.deepEqual(d.questions.map((q: any) => [q.status, q.marks]), [["incorrect", -1], ["incorrect", -1], ["unanswered", 0], ["unanswered", 0], ["unanswered", 0]]);
    assert.equal(d.questions[0].selected, "B");
    assert.equal(d.questions[0].question.correctAnswer, "A");
    assert.equal(d.questions[0].question.explanation, "Solution 0");
    assert.equal(d.questions[0].question.chapter, "Electrostatics");
    // Two questions answered wrong in one topic: weak for this student.
    assert.deepEqual(d.weakTopics.map((t: any) => [t.label, t.accuracy, t.correct, t.attempted]), [["Electric Field", 0, 0, 2]]);
  });

  test("a tied student gets the shared rank; a numerical answer shows as given", async () => {
    const id = await standardTest();
    assert.equal((await detail(id, "teacher", "s2")).rank, 2);
    assert.equal((await detail(id, "teacher", "s7")).rank, 2);
    const d = await detail(id, "teacher", "s1");
    assert.deepEqual([d.questions[3].selected, d.questions[3].status], ["9.80", "correct"]);
  });

  test("the tuition admin can read it; a student who never started or is still answering has no result", async () => {
    const id = await standardTest();
    await detail(id, "admin", "s1");
    await detail(id, "teacher", "s6", 404);
    const live = await room({ closesAt: new Date(Date.now() + 5 * HOUR) });
    await m.TestAttempt.create({ tuitionId: ids.tuition, testId: live, batchId: ids.batch, studentId: ids.s1, startedAt: new Date(), answers: [] });
    await detail(live, "teacher", "s1", 409);
  });
});

describe("the student's own result", () => {
  test("after the test closes: own rank, percentage, accuracy and topics, and nobody else's marks or answers", async () => {
    const id = await standardTest();
    const body = await own(id, "s2");
    assert.deepEqual(
      [body.analytics.rank, body.analytics.ranked, body.analytics.percentage, body.analytics.accuracy, body.analytics.unanswered, body.analytics.negativeDeducted],
      [2, 4, 55, 75, 1, 1]
    );
    assert.equal(body.attempt.result.score, 11);
    assert.equal(body.attempt.answers.find((a: any) => a.index === 3).correct, false);
    assert.ok(body.questions.every((q: any) => "correctAnswer" in q));
    const text = JSON.stringify(body);
    for (const other of ["s1", "s3", "s6", "s7"]) assert.ok(!text.includes(ids[other]) && !text.includes(names[other]), `leaks ${other}`);
    assert.ok(!("rankings" in body) && !("results" in body));
  });

  test("a student who did not take a closed test gets the questions but no analytics", async () => {
    const id = await standardTest();
    const body = await own(id, "s6");
    assert.equal(body.analytics, null);
    assert.equal(body.attempt, null);
  });

  test("before the test closes: no score, rank, correctness or answers, even after submitting", async () => {
    const id = await room({ closesAt: new Date(Date.now() + 5 * HOUR) });
    await attempt(id, "s1", { 0: "A", 1: "B", 2: "C", 3: "9.8", 4: "A" });
    const body = await own(id, "s1");
    assert.equal(body.analytics, null);
    assert.deepEqual(Object.keys(body.attempt.result), ["submittedAt"]);
    assert.ok(body.attempt.answers.every((a: any) => a.correct === null));
    assert.ok(body.questions.every((q: any) => !("correctAnswer" in q) && !("explanation" in q)));
  });

  test("the release is the closing time: a test closed early releases at once, and not before", async () => {
    const id = await room({ closesAt: new Date(Date.now() + 5 * HOUR) });
    await attempt(id, "s1", { 0: "A" });
    assert.equal((await own(id, "s1")).analytics, null);
    await json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), { params: { id } }), 200);
    assert.equal((await own(id, "s1")).analytics.rank, 1);
  });
});

describe("authorization and isolation", () => {
  test("students cannot read the results or another student's performance", async () => {
    const id = await standardTest();
    assert.equal((await resultsRes(id, "s1")).status, 403);
    assert.equal((await detailRes(id, ids.s3, "s1")).status, 403);
    assert.equal((await detailRes(id, ids.s1, "s1")).status, 403);
  });

  test("unauthenticated requests are refused", async () => {
    const id = await standardTest();
    assert.equal((await m.resultsRoute.GET(req("GET", `/api/tests/${id}/results`), { params: { id } })).status, 401);
  });

  test("a teacher who does not teach the batch, and a teacher or admin of another tuition, find nothing", async () => {
    const id = await standardTest();
    for (const who of ["outsider", "strange"]) {
      assert.equal((await resultsRes(id, who)).status, 404, who);
      assert.equal((await detailRes(id, ids.s1, who)).status, 404, who);
    }
  });

  test("a student's id from another batch or tuition, or a malformed id, is not found", async () => {
    const id = await standardTest();
    await detail(id, "teacher", "s4", 404); // another batch: no attempt on this test
    await detail(id, "teacher", "s5", 404); // another tuition
    await detail(id, "teacher", "not-an-id", 404);
    // Even with an attempt row forged for another tuition's student, it is not readable here.
    const test = (await m.TestRoom.findById(id))!;
    await m.TestAttempt.create({ tuitionId: (await m.Tuition.create({ name: "Tuition C" }))._id, testId: id, batchId: test.batchId, studentId: ids.s5, startedAt: new Date(), submittedAt: new Date() });
    await detail(id, "teacher", "s5", 404);
    const r = await results(id);
    assert.ok(!r.rankings.some((x: any) => x.student.id === ids.s5));
  });

  test("another batch's test is not found by a student of a different batch", async () => {
    const id = await standardTest();
    assert.ok([403, 404].includes((await m.testRoute.GET(req("GET", `/api/tests/${id}`, "s4"), { params: { id } })).status));
    assert.ok([403, 404].includes((await m.testRoute.GET(req("GET", `/api/tests/${id}`, "s5"), { params: { id } })).status));
  });
});

describe("legacy and unusual data", () => {
  test("an attempt without a maximum, counts or answers still gives finite figures", () => {
    const test = { questions: new Array(5).fill({ correctAnswer: "A" }), marksPerQuestion: 4, negativeMarks: 1, durationMinutes: 60, closesAt: new Date() } as never;
    const mm = m.results.measuresOf(test, { score: 0, maxScore: 0, correctCount: 0, wrongCount: 0, skippedCount: 0, timeTakenSeconds: 0 } as never);
    assert.deepEqual([mm.maxScore, mm.percentage, mm.accuracy, mm.unanswered, mm.negativeDeducted], [20, 0, null, 5, 0]);
    assert.equal(m.results.ratio(1, 0), null);
    assert.equal(m.results.ratio(Number.NaN, 5), null);
  });

  test("a perfect score, a zero score and equal scores rank sensibly", () => {
    const rows = [
      { id: "a", name: "A", score: 0, timeTakenSeconds: 10 },
      { id: "b", name: "B", score: 20, timeTakenSeconds: 99 },
      { id: "c", name: "C", score: 0.1 + 0.2, timeTakenSeconds: 5 },
      { id: "d", name: "D", score: 0.3, timeTakenSeconds: 5 },
    ];
    assert.deepEqual(
      m.results.rankRows(rows).map((r: any) => [r.id, r.rank]),
      [["b", 1], ["c", 2], ["d", 2], ["a", 4]] // 0.1 + 0.2 and 0.3 are the same score
    );
    assert.equal(m.results.rankOf(0.3, [0.1 + 0.2, 20, 0]), 2);
  });
});

describe("data is only read", () => {
  test("scores, attempts, test questions and the question bank are unchanged by reading results; the monitor still works", async () => {
    const id = await standardTest();
    await results(id); // first read after close settles any suspended attempt; later reads must not change data
    const before = [await attemptsDigest(), await roomsDigest(), await bank()];
    await results(id);
    await detail(id, "teacher", "s1");
    await own(id, "s1");
    assert.deepEqual([await attemptsDigest(), await roomsDigest(), await bank()], before);
    assert.equal(await bank(), bankDigest);
    const mon = await json(await m.monitorRoute.GET(req("GET", `/api/tests/${id}/monitor`, "teacher"), { params: { id } }), 200);
    assert.deepEqual(mon.counts, { total: 5, notStarted: 1, inProgress: 0, submitted: 4, autoSubmitted: 1, violations: 1 });
  });

  test("a real attempt (start, save, submit, close) is ranked with the score finalize stored", async () => {
    const id = await room({ opensAt: new Date(Date.now() - HOUR), closesAt: new Date(Date.now() + 5 * HOUR) });
    const params = { params: { id } };
    await json(await m.startRoute.POST(req("POST", `/api/tests/${id}/start`, "s1"), params), 200);
    await json(await m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, "s1", { answers: [{ index: 0, selected: "A" }, { index: 1, selected: "C" }] }), params), 200);
    await json(await m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, "s1", {}), params), 200);
    await json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), params), 200);
    const stored = (await m.TestAttempt.findOne({ testId: id, studentId: ids.s1 }))!;
    assert.equal(stored.score, 3); // 4 − 1
    const r = await results(id);
    assert.deepEqual([row(r, "s1").score, row(r, "s1").rank, row(r, "s1").correct, row(r, "s1").incorrect], [stored.score, 1, 1, 1]);
    assert.equal((await own(id, "s1")).analytics.negativeDeducted, 1);
  });
});

describe("history: finished attempts outlive current membership", () => {
  const restore = () => m.User.updateOne({ _id: ids.s2 }, { tuitionId: ids.tuition, batchId: ids.batch, role: "student", active: true });

  test("a student moved to another batch, turned off, or removed from the tuition stays ranked with the same scores", async () => {
    const id = await standardTest();
    const base = await results(id);
    for (const change of [{ batchId: (await m.Batch.findOne({ name: "12 JEE" }))!._id }, { active: false }, { tuitionId: null, role: null, batchId: null }]) {
      await m.User.updateOne({ _id: ids.s2 }, change);
      try {
        const r = await results(id);
        assert.deepEqual(r.rankings.map((x: any) => [x.student.id, x.rank, x.score]), base.rankings.map((x: any) => [x.student.id, x.rank, x.score]), JSON.stringify(change));
        assert.equal(r.summary.former, "tuitionId" in change ? 1 : 0, JSON.stringify(change));
        assert.deepEqual([r.summary.attempted, r.summary.highest, r.summary.lowest, r.summary.averageScore, r.summary.autoSubmitted], [4, 20, -2, 10, 1], JSON.stringify(change));
        assert.equal(row(r, "s2").student.name, names.s2);
        assert.equal((await detail(id, "teacher", "s2")).rank, 2, JSON.stringify(change));
      } finally {
        await restore();
      }
    }
  });

  test("summary counts agree with the Phase 2C monitor", async () => {
    const id = await standardTest();
    const r = await results(id);
    const mon = await json(await m.monitorRoute.GET(req("GET", `/api/tests/${id}/monitor`, "teacher"), { params: { id } }), 200);
    assert.deepEqual(
      [r.summary.total, r.summary.notAttempted, r.summary.attempted, r.summary.autoSubmitted, r.summary.violations],
      [mon.counts.total, mon.counts.notStarted, mon.counts.submitted, mon.counts.autoSubmitted, mon.counts.violations]
    );
  });

  test("reading results does not rewrite finalized attempts", async () => {
    const id = await standardTest();
    const before = await attemptsDigest();
    await results(id);
    await results(id);
    assert.equal(await attemptsDigest(), before);
  });
});

describe("ranking precision", () => {
  test("scores a hundredth apart are not tied; display rounding never decides a rank", () => {
    const rows = [
      { id: "a", name: "A", score: 4.51, timeTakenSeconds: 900 },
      { id: "b", name: "B", score: 4.5, timeTakenSeconds: 1 },
      { id: "c", name: "C", score: -0.5, timeTakenSeconds: 1 },
      { id: "d", name: "D", score: -0.51, timeTakenSeconds: 1 },
    ];
    // B is far quicker but scored less, so time never lifts it above A.
    assert.deepEqual(m.results.rankRows(rows).map((r: any) => [r.id, r.rank]), [["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
  });

  test("rank numbering after a three-way tie", () => {
    const rows = ["a", "b", "c", "d"].map((id, i) => ({ id, name: id, score: i < 3 ? 8 : 4, timeTakenSeconds: 10 - i }));
    assert.deepEqual(m.results.rankRows(rows).map((r: any) => [r.id, r.rank]), [["c", 1], ["b", 1], ["a", 1], ["d", 4]]);
  });
});

describe("release: the actual response before and after closing", () => {
  test("before closing, a submitted student's response carries no scores, ranks, correctness, keys, solutions or topics", async () => {
    const id = await room({ closesAt: new Date(Date.now() + 5 * HOUR) });
    await attempt(id, "s1", { 0: "A", 1: "C", 2: "C", 3: "9.8", 4: "A" });
    const body = await own(id, "s1");
    const text = JSON.stringify(body);
    assert.equal(body.analytics, null);
    assert.deepEqual(Object.keys(body.attempt.result), ["submittedAt"]);
    for (const leak of ["correctAnswer", "explanation", "Solution", "rank", "score", "percentage", "accuracy", "recommendation"]) {
      assert.ok(!text.includes(leak), `leaks ${leak}`);
    }
    assert.ok(body.attempt.answers.every((a: any) => a.correct === null));
  });

  test("after closing, a student gets only their own figures; the teacher routes stay closed to them", async () => {
    const id = await standardTest();
    const text = JSON.stringify(await own(id, "s7"));
    for (const other of ["s1", "s2", "s3", "s6"]) assert.ok(!text.includes(ids[other]) && !text.includes(names[other]));
    assert.equal((await resultsRes(id, "s7")).status, 403);
  });
});


test("live tests with submitted attempts withhold teacher results, keys, solutions and averages", async () => {
  const id = await room({ closesAt: new Date(Date.now() + 5 * HOUR) });
  await attempt(id, "s1", { 0: "A" });
  for (const who of ["teacher", "admin"]) {
    await results(id, who, 409);
    await detail(id, who, "s1", 409);
    await json(await m.analysisRoute.GET(req("GET", `/api/analysis/test/${id}`, who), { params: { id } }), 409);
    const body = await own(id, who);
    assert.deepEqual(body.results, []);
    assert.equal(body.test.averageScore, null);
    assert.ok(body.questions.every((q: any) => !("correctAnswer" in q) && !("explanation" in q) && !("explanationDiagramUrls" in q)));
  }
});
