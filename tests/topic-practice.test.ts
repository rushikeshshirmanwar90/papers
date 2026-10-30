// Topic practice: past-year questions by syllabus chapter and topic, with the
// student's saved progress. Runs the real route handlers against a throwaway
// in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [topicsRoute, questionsRoute, answerRoute, auth, db] = await Promise.all([
    import("@/app/api/pyq/topics/route"),
    import("@/app/api/pyq/questions/route"),
    import("@/app/api/pyq/answer/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    topicsRoute,
    questionsRoute,
    answerRoute,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    Question: (await import("@/models/Question")).default,
    PracticeAnswer: (await import("@/models/PracticeAnswer")).default,
    SyllabusProgress: (await import("@/models/SyllabusProgress")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
/** Projectile Motion question ids, in id order, with their answer keys. */
let projectile: { id: string; key: string }[] = [];

async function seed() {
  const { Tuition, User, Batch, Question, SyllabusProgress, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const user = (email: string, role: string, extra: Record<string, unknown> = {}) =>
    User.create({ email, name: email, passwordHash: "x", role, tuitionId: tuition._id, emailVerified: true, ...extra });
  const teacher = await user("teacher@test.local", "teacher");
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", standard: "11th", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const student = await user("student@test.local", "student", { track: "JEE", standard: "11th", batchId: batch._id });
  const other = await user("other@test.local", "student", { track: "JEE", standard: "11th" });
  const neet = await user("neet@test.local", "student", { track: "NEET", standard: "11th" });
  tokens.teacher = await auth.signToken(teacher);
  tokens.student = await auth.signToken(student);
  tokens.other = await auth.signToken(other);
  tokens.neet = await auth.signToken(neet);
  ids.student = String(student._id);
  ids.other = String(other._id);

  const paperId = new (await import("mongoose")).Types.ObjectId();
  let n = 0;
  const q = (chapter: string, topic: string, source: string, extra: Record<string, unknown> = {}) => ({
    paperId,
    questionNumber: ++n,
    subject: "Physics",
    examCategory: "JEE/NEET",
    standard: "11th",
    chapter,
    topic,
    source,
    questionText: `Secret question ${n}`,
    optionA: "1",
    optionB: "2",
    optionC: "3",
    optionD: "4",
    correctAnswer: n % 2 ? "A" : "B",
    answerType: "MCQ",
    explanation: `Secret solution ${n}`,
    ...extra,
  });
  // Inserted one by one so ids follow this order.
  for (let i = 0; i < 12; i++) await Question.create(q("Kinematics", "Projectile Motion", "JEE MAIN 2022"));
  for (let i = 0; i < 3; i++) await Question.create(q("Kinematics", "Relative Velocity", "AIEEE 2005"));
  for (let i = 0; i < 2; i++) await Question.create(q("Kinematics", "", "JEE MAIN 2019")); // chapter only, no topic
  await Question.create(q("Kinematics", "Projectile Motion", "")); // not a past-year question
  await Question.create(q("Kinematics", "Projectile Motion", "NEET 2019")); // another track's exam
  await Question.create(q("Kinematics", "Projectile Motion", "JEE MAIN 2021", { answerType: "Descriptive" }));
  for (let i = 0; i < 2; i++) await Question.create(q("Units and Dimensions", "", "JEE MAIN 2020")); // a chapter without named topics
  await Question.create(q("Laws of Motion", "Friction", "")); // in the syllabus, no past-year questions

  const all = await Question.find({ topic: "Projectile Motion", source: "JEE MAIN 2022" }).sort({ _id: 1 }).lean<{ _id: unknown; correctAnswer: string }[]>();
  projectile = all.map((x) => ({ id: String(x._id), key: x.correctAnswer }));
  ids.neetOnly = String((await Question.findOne({ source: "NEET 2019" }))!._id);
  ids.notPyq = String((await Question.findOne({ source: "", topic: "Projectile Motion" }))!._id);

  await SyllabusProgress.create({ tuitionId: tuition._id, batchId: batch._id, subject: "Physics", standard: "11th", chapter: "Kinematics", topic: "Projectile Motion", coveredOn: new Date(), teacherId: teacher._id });
  await SyllabusProgress.create({ tuitionId: tuition._id, batchId: batch._id, subject: "Physics", standard: "11th", chapter: "Units and Dimensions", topic: "", coveredOn: new Date(), teacherId: teacher._id });
}

const req = (method: string, path: string, who: keyof typeof tokens, body?: unknown) =>
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

type Page = { total: number; summary: Record<string, number | null>; questions: Record<string, unknown>[]; next: string | null };
const KINEMATICS = "subject=Physics&standard=11th&chapter=Kinematics";
const PROJECTILE = `${KINEMATICS}&topic=Projectile%20Motion`;

const topics = async (who: keyof typeof tokens, query = "subject=Physics", status = 200) =>
  json(await m.topicsRoute.GET(req("GET", `/api/pyq/topics?${query}`, who), {}), status);
const page = async (who: keyof typeof tokens, query: string, status = 200): Promise<Page> =>
  json(await m.questionsRoute.GET(req("GET", `/api/pyq/questions?${query}`, who), {}), status);
const answer = async (who: keyof typeof tokens, questionId: string, selected: string, status = 200, extra: Record<string, unknown> = {}) =>
  json(await m.answerRoute.POST(req("POST", "/api/pyq/answer", who, { questionId, selected, ...extra }), {}), status);
const wrongKey = (key: string) => (key === "A" ? "B" : "A");

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "topic_practice_test";
  process.env.JWT_SECRET = "topic-practice-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("GET /api/pyq/topics", () => {
  test("lists the syllabus with past-year question counts, coverage and no question content", async () => {
    const body = await topics("student");
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes("Secret"), "no question text or solutions");

    const kin = body.chapters.find((c: { chapter: string }) => c.chapter === "Kinematics");
    assert.equal(kin.questions, 17, "12 + 3 topic questions and 2 without a topic, for JEE only");
    assert.equal(kin.untagged, 2);
    assert.equal(kin.mine, true);
    assert.deepEqual(kin.topics.map((t: { topic: string }) => t.topic), ["Projectile Motion", "Relative Velocity"], "no made-up topic for the untagged ones");
    const proj = kin.topics.find((t: { topic: string }) => t.topic === "Projectile Motion");
    assert.equal(proj.questions, 12);
    assert.ok(proj.coveredOn, "covered by the batch");
    assert.equal(kin.topics.find((t: { topic: string }) => t.topic === "Relative Velocity").coveredOn, null);
    assert.equal(kin.coveredTopics, 1);

    const units = body.chapters.find((c: { chapter: string }) => c.chapter === "Units and Dimensions");
    assert.deepEqual(units.topics, [], "a chapter without named topics has no topic level");
    assert.equal(units.questions, 2);
    assert.ok(units.coveredOn);

    const laws = body.chapters.find((c: { chapter: string }) => c.chapter === "Laws of Motion");
    assert.equal(laws.questions, 0, "in the syllabus but without past-year questions");
    assert.equal(laws.accuracy, null);
  });

  test("only the student's own track subjects, and students only", async () => {
    await topics("student", "subject=Biology", 400);
    await topics("teacher", "subject=Physics", 403);
  });
});

describe("GET /api/pyq/questions", () => {
  test("pages of 10 in a stable order without repeats, and no answers before answering", async () => {
    const first = await page("student", PROJECTILE);
    assert.equal(first.total, 12);
    assert.equal(first.questions.length, 10);
    assert.ok(first.next);
    for (const q of first.questions) {
      assert.equal(q.correctAnswer, undefined);
      assert.equal(q.explanation, undefined);
      assert.equal(q.paperId, undefined);
    }
    const second = await page("student", `${PROJECTILE}&after=${first.next}`);
    assert.equal(second.questions.length, 2);
    assert.equal(second.next, null);
    assert.deepEqual([...first.questions, ...second.questions].map((q) => q._id), projectile.map((p) => p.id));
  });

  test("the whole chapter includes questions without a topic", async () => {
    const all = await page("student", `${KINEMATICS}&limit=20`);
    assert.equal(all.total, 17);
    assert.equal(all.questions.filter((q) => q.topic === "").length, 2);
  });

  test("checks its parameters", async () => {
    await page("student", `${PROJECTILE}&limit=50`, 400);
    await page("student", `${PROJECTILE}&limit=0`, 400);
    await page("student", `${PROJECTILE}&after=nope`, 400);
    await page("student", `${PROJECTILE}&status=everything`, 400);
    await page("student", "subject=Physics&standard=9th&chapter=Kinematics", 400);
    await page("student", "subject=Physics&standard=11th", 400);
    await page("student", "subject=Biology&standard=11th&chapter=Kinematics", 400);
    await page("teacher", PROJECTILE, 403);
    const none = await page("student", "subject=Physics&standard=11th&chapter=No%20such%20chapter");
    assert.equal(none.total, 0);
    assert.deepEqual(none.questions, []);
  });
});

describe("answers and progress", () => {
  test("an answer is marked on the server and saved for the logged-in student only", async () => {
    const [a, b] = projectile;
    const right = await answer("student", a.id, a.key, 200, { studentId: ids.other });
    assert.equal(right.correct, true);
    assert.equal(right.saved, true);
    assert.equal(right.correctAnswer, a.key);
    const wrong = await answer("student", b.id, wrongKey(b.key));
    assert.equal(wrong.correct, false);

    assert.equal(await m.PracticeAnswer.countDocuments({ studentId: ids.student }), 2);
    assert.equal(await m.PracticeAnswer.countDocuments({ studentId: ids.other }), 0, "a studentId in the body is ignored");
  });

  test("answering again updates the one record instead of adding another", async () => {
    const [a] = projectile;
    await answer("student", a.id, a.key);
    await answer("student", a.id, a.key);
    assert.equal(await m.PracticeAnswer.countDocuments({ studentId: ids.student, questionId: a.id }), 1);
  });

  test("questions outside the student's past-year questions can't be answered", async () => {
    await answer("student", ids.neetOnly, "A", 404);
    await answer("student", ids.notPyq, "A", 404);
    await answer("student", "not-an-id", "A", 404);
    assert.equal(await m.PracticeAnswer.countDocuments({ studentId: ids.student }), 2);
  });

  test("continue, review and retry follow the saved answers", async () => {
    const [a, b] = projectile;
    const unanswered = await page("student", `${PROJECTILE}&status=unanswered&limit=20`);
    assert.equal(unanswered.total, 10);
    assert.ok(!unanswered.questions.some((q) => q._id === a.id || q._id === b.id));
    assert.deepEqual(unanswered.summary, { questions: 12, answered: 2, correct: 1, wrong: 1, remaining: 10, accuracy: 50 });

    const review = await page("student", `${PROJECTILE}&status=answered`);
    assert.deepEqual(review.questions.map((q) => q._id), [a.id, b.id]);
    assert.equal(review.questions[1].correctAnswer, b.key, "review shows the answer");
    assert.ok(String(review.questions[1].explanation).startsWith("Secret solution"));
    assert.deepEqual(review.questions[1].mine, { selected: wrongKey(b.key), correct: false });

    const retry = await page("student", `${PROJECTILE}&status=incorrect`);
    assert.deepEqual(retry.questions.map((q) => q._id), [b.id]);
    assert.equal(retry.questions[0].correctAnswer, undefined, "a retry doesn't give the answer away");

    await answer("student", b.id, b.key);
    assert.equal((await page("student", `${PROJECTILE}&status=incorrect`)).total, 0);
    const after = await page("student", `${PROJECTILE}&status=answered`);
    assert.deepEqual({ answered: after.summary.answered, correct: after.summary.correct, wrong: after.summary.wrong }, { answered: 2, correct: 2, wrong: 0 });
  });

  test("continuing page by page skips nothing and repeats nothing while answering", async () => {
    const seen: string[] = [];
    let next: string | null = null;
    do {
      const p: Page = await page("student", `${PROJECTILE}&status=unanswered&limit=3${next ? `&after=${next}` : ""}`);
      for (const q of p.questions) {
        seen.push(q._id as string);
        const key = projectile.find((x) => x.id === q._id)!.key;
        await answer("student", q._id as string, seen.length % 2 ? key : wrongKey(key));
      }
      next = p.next;
    } while (next);
    assert.deepEqual(seen, projectile.slice(2).map((p) => p.id));
    assert.equal(new Set(seen).size, seen.length);
    assert.equal((await page("student", `${PROJECTILE}&status=unanswered`)).total, 0, "all attempted");
  });

  test("topic and chapter progress add up without double counting", async () => {
    const body = await topics("student");
    const kin = body.chapters.find((c: { chapter: string }) => c.chapter === "Kinematics");
    const proj = kin.topics.find((t: { topic: string }) => t.topic === "Projectile Motion");
    assert.equal(proj.answered, 12);
    assert.equal(proj.remaining, 0);
    assert.equal(proj.correct + proj.wrong, 12);
    assert.equal(proj.accuracy, Math.round((proj.correct / 12) * 100));
    assert.equal(kin.answered, 12);
    assert.equal(kin.remaining, 5);
    assert.equal(body.summary.answered, 12);
  });

  test("another student sees none of this progress", async () => {
    const theirs = await page("other", PROJECTILE);
    assert.ok(theirs.questions.every((q) => q.mine === null));
    assert.equal(theirs.summary.answered, 0);
    const tree = await topics("other");
    assert.equal(tree.summary.answered, 0);
    assert.equal(tree.hasBatch, false);
    assert.ok(tree.chapters.every((c: { coveredTopics: number }) => c.coveredTopics === 0), "no batch, nothing covered");
  });

  test("a NEET student gets the NEET question, not the JEE ones", async () => {
    const neet = await page("neet", PROJECTILE);
    assert.equal(neet.total, 1);
    assert.equal(neet.questions[0]._id, ids.neetOnly);
    await answer("neet", projectile[0].id, "A", 404);
  });
});
