// Questions flagged for broken options (scripts/flag-broken-mcq-options.mjs)
// stay out of practice, self-assessments and new tests until an admin edit
// fixes them; then they come back on their own.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { optionReviewReasons } from "@/lib/question-review";

describe("optionReviewReasons", () => {
  const q = (a: string, b: string, c: string, d: string, extra: Record<string, unknown> = {}) => ({ answerType: "MCQ", optionA: a, optionB: b, optionC: c, optionD: d, ...extra });
  test("sound questions, True/False and three-option questions are fine", () => {
    assert.deepEqual(optionReviewReasons(q("1", "2", "3", "4", { correctAnswer: "D" })), []);
    assert.deepEqual(optionReviewReasons(q("True", "False", "", "", { correctAnswer: "B" })), []);
    assert.deepEqual(optionReviewReasons(q("x", "y", "z", "")), []);
    assert.deepEqual(optionReviewReasons({ answerType: "Descriptive" }), [], "not an MCQ");
  });
  test("a gap, only A, no options, a key on an empty option", () => {
    assert.deepEqual(optionReviewReasons(q("Glycol", "Glycerol", "", "Pentanol")), ["gap"]);
    assert.deepEqual(optionReviewReasons(q("6x^3", "", "", "", { correctAnswer: "A" })), ["only-a"]);
    assert.deepEqual(optionReviewReasons(q("", "", "", "")), ["no-options"]);
    assert.deepEqual(optionReviewReasons(q("a", "b", "c", "", { correctAnswer: " d " })), ["key-on-empty-option"]);
  });
  test("an option with only a figure counts as filled", () => {
    assert.deepEqual(optionReviewReasons(q("a", "", "c", "d", { optionDiagramUrls: { B: ["x.png"] } })), []);
  });
});

let mongod: MongoMemoryServer;
const ADMIN_KEY = "question-review-test-admin-key-0123456789";
let m: {
  Question: typeof import("@/models/Question").default;
  pyq: typeof import("@/lib/pyq");
  bank: typeof import("@/lib/makePdfBank");
  pick: typeof import("@/lib/questionPick");
  edit: typeof import("@/app/api/questions/[id]/route");
};
const ids: Record<string, string> = {};
const PAPER = new Types.ObjectId();
let n = 0;
const q = (over: Record<string, unknown> = {}) => ({
  paperId: PAPER,
  questionNumber: ++n,
  examCategory: "JEE/NEET",
  standard: "11th",
  subject: "Physics",
  chapter: "Kinematics",
  topic: "Velocity",
  difficulty: "Medium",
  questionText: `Question ${n}`,
  optionA: "a",
  optionB: "b",
  optionC: "c",
  optionD: "d",
  correctAnswer: "A",
  answerType: "MCQ",
  source: "JEE MAIN 2020",
  ...over,
});

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = "question_review_test";
  process.env.JWT_SECRET = "question-review-test-jwt-secret-0123456789abcdef";
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  await (await import("@/lib/db")).connectDB();
  m = {
    Question: (await import("@/models/Question")).default,
    pyq: await import("@/lib/pyq"),
    bank: await import("@/lib/makePdfBank"),
    pick: await import("@/lib/questionPick"),
    edit: await import("@/app/api/questions/[id]/route"),
  };
  const docs = {
    good: q(),
    trueFalse: q({ optionA: "True", optionB: "False", optionC: "", optionD: "", correctAnswer: "B" }),
    flagged: q({ optionB: "", reviewFlags: { options: ["gap"], flaggedAt: new Date() } }),
    flaggedTwo: q({ optionB: "", optionC: "", optionD: "", correctAnswer: "C", reviewFlags: { options: ["only-a", "key-on-empty-option"], flaggedAt: new Date() } }),
  };
  for (const [key, doc] of Object.entries(docs)) ids[key] = String((await m.Question.create(doc))._id);
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod.stop();
});

const idsIn = (docs: { _id: unknown }[]) => docs.map((d) => String(d._id)).sort();
const notFlagged = () => [ids.good, ids.trueFalse].sort();

describe("flagged questions are left out until fixed", () => {
  test("practice and self-assessments (the PYQ bank filter)", async () => {
    assert.deepEqual(idsIn(await m.Question.find(m.pyq.pyqBankFilter("JEE")).select("_id").lean()), notFlagged());
    assert.deepEqual(idsIn(await m.Question.find(m.pyq.pyqFilter("JEE", "Physics", "Kinematics")).select("_id").lean()), notFlagged());
  });

  test("the teacher's question list for a new test, and the server check when it's created", async () => {
    const scope = m.bank.readScope({ course: "Competitive", standard: "11th", exam: "JEE", subject: "Physics", source: "regular" });
    assert.deepEqual(idsIn((await m.bank.pageOfQuestions(scope, 1, 50)).questions as { _id: unknown }[]), notFlagged());
    const checked = await m.bank.verifyQuestions(scope, [ids.good, ids.flagged]);
    assert.equal(checked.dropped, 1, "a flagged question sent by an old app is refused");
  });

  test("random picks (Make PDF and pick-for-me)", async () => {
    const picked = await m.pick.pickFromBank({ exam: "JEE", subject: "Physics", chapters: [], topics: [], quota: { kind: "any", count: 10 }, answerType: "MCQ", exclude: [] });
    assert.deepEqual(idsIn(picked.questions as { _id: unknown }[]), notFlagged());
    assert.equal(picked.available.total, 2, "flagged questions aren't counted as available either");
  });
});

describe("an admin edit re-checks the flag", () => {
  const patch = (id: string, body: Record<string, unknown>) =>
    m.edit.PATCH(new NextRequest(`http://localhost:3000/api/questions/${id}`, { method: "PATCH", headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: { id } });

  test("an edit that doesn't fix the options keeps the flag (with the current reasons)", async () => {
    const res = await patch(ids.flaggedTwo, { optionB: "two" });
    assert.equal(res.status, 200);
    const doc = await m.Question.findById(ids.flaggedTwo).lean();
    assert.deepEqual(doc?.reviewFlags?.options, ["key-on-empty-option"]);
  });

  test("fixing the options clears the flag, and the question is back in practice", async () => {
    const res = await patch(ids.flagged, { optionB: "b" });
    assert.equal(res.status, 200);
    const doc = await m.Question.findById(ids.flagged).lean();
    assert.equal(doc?.reviewFlags, undefined);
    assert.ok(idsIn(await m.Question.find(m.pyq.pyqBankFilter("JEE")).select("_id").lean()).includes(ids.flagged));
  });

  test("editing a sound question never adds a flag", async () => {
    await patch(ids.good, { optionC: "", optionD: "" });
    const doc = await m.Question.findById(ids.good).lean();
    assert.equal(doc?.reviewFlags, undefined, "flags come only from the script, not from edits");
  });
});
