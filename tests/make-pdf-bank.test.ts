// One-page Make PDF question discovery (lib/makePdfBank.ts): Foundation and
// Competitive scopes, MCQ-only, bank-copy exclusion, chapter/topic/year
// options, exact counts, manual and random selection, and PYQ attribution.
// Runs against a throwaway in-memory MongoDB.
//   npx tsx --test tests/make-pdf-bank.test.ts
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";

let mongod: MongoMemoryServer;
let bank: typeof import("@/lib/makePdfBank");
let ids: Record<string, string> = {};

type Doc = Record<string, unknown>;
let n = 0;
const PAPER = new Types.ObjectId();
const q = (over: Doc): Doc => ({
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
  source: "",
  ...over,
});

const docs: Record<string, Doc> = {
  f9m: q({ examCategory: "Foundation", standard: "9th", subject: "Mathematics", chapter: "Number Systems", topic: "Rationals" }),
  f9s: q({ examCategory: "Foundation", standard: "9th", subject: "Science", chapter: "Motion", topic: "Speed" }),
  f10m: q({ examCategory: "Foundation", standard: "10th", subject: "Mathematics", chapter: "Real Numbers", topic: "Euclid" }),
  f10s: q({ examCategory: "Foundation", standard: "10th", subject: "Science", chapter: "Light", topic: "Lenses" }),
  f10sDesc: q({ examCategory: "Foundation", standard: "10th", subject: "Science", chapter: "Light", answerType: "Descriptive" }),
  f10sCopy: q({ examCategory: "Foundation", standard: "10th", subject: "Science", chapter: "Light", bankCopy: true }),
  f10sCaps: q({ examCategory: "Foundation", standard: "10th", subject: "Science", chapter: "LIGHT", topic: "Mirrors" }),
  phys: q({ chapter: "Kinematics", topic: "Velocity" }),
  physNum: q({ answerType: "Numerical" }),
  physCopy: q({ bankCopy: true }),
  physJee20: q({ chapter: "Kinematics", topic: "Speed", source: "JEE MAIN 2020" }),
  physJee21: q({ chapter: "Optics", topic: "Lenses", source: "JEE Main 2021" }),
  physNeet19: q({ chapter: "Optics", topic: "Lenses", source: "NEET 2019" }),
  physBitsat: q({ source: "BITSAT 2018" }),
  physMht: q({ source: "MHT CET 2021" }),
  physMixed: q({ source: "JEE MAIN 2020, NEET 2019" }),
  physJeeBitsat: q({ source: "JEE MAIN 2020, BITSAT 2019" }),
  physNoYear: q({ source: "JEE Main" }),
  physWbjee: q({ source: "WBJEE 2017" }),
  bio: q({ subject: "Biology", chapter: "Cell", topic: "Organelles", standard: "12th" }),
  botany: q({ subject: "Botany", chapter: "Plants", topic: "Roots", standard: "12th" }),
  bioNeet: q({ subject: "Biology", chapter: "Cell", topic: "Organelles", standard: "12th", source: "NEET 2022" }),
  mathJee: q({ subject: "Mathematics", chapter: "Limits", topic: "L1", source: "IIT-JEE 2005" }),
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = "make_pdf_bank_test";
  process.env.JWT_SECRET = "make-pdf-bank-test-jwt-secret-0123456789abcdef";
  const db = await import("@/lib/db");
  await db.connectDB();
  const Question = (await import("@/models/Question")).default;
  const keys = Object.keys(docs);
  const created = await Question.insertMany(keys.map((key) => docs[key]));
  ids = Object.fromEntries(keys.map((key, i) => [key, String(created[i]._id)]));
  bank = await import("@/lib/makePdfBank");
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod.stop();
});

const comp = (over: Doc = {}) => bank.readScope({ course: "Competitive", standard: "11th", exam: "JEE", subject: "Physics", source: "regular", ...over });
const found = async (scope: ReturnType<typeof bank.readScope>) => (await bank.pageOfQuestions(scope, 1, 50)).questions.map((d) => String(d._id));
const idsOf = (...keys: string[]) => keys.map((key) => ids[key]).sort();

describe("Foundation scopes", () => {
  for (const [standard, subject, key] of [["9th", "Mathematics", "f9m"], ["9th", "Science", "f9s"], ["10th", "Mathematics", "f10m"]] as const) {
    test(`${standard} ${subject}`, async () => {
      const scope = bank.readScope({ course: "Foundation", standard, subject });
      assert.deepEqual(await found(scope), [ids[key]]);
      const options = await bank.scopeOptions(scope);
      assert.equal(options.total, 1);
      assert.equal(options.years.length, 0);
    });
  }

  test("10th Science: MCQs only, no duplicate copies, capitalisation merged", async () => {
    const scope = bank.readScope({ course: "Foundation", standard: "10th", subject: "Science" });
    assert.deepEqual((await found(scope)).sort(), idsOf("f10s", "f10sCaps"));
    const options = await bank.scopeOptions(scope);
    assert.equal(options.total, 2);
    assert.equal(options.chapters.length, 1, "Light and LIGHT are one chapter");
    assert.equal(options.chapters[0].count, 2);
  });

  test("Foundation has no exam, no Physics split and no PYQs", () => {
    assert.throws(() => bank.readScope({ course: "Foundation", standard: "9th", subject: "Physics" }));
    assert.throws(() => bank.readScope({ course: "Foundation", standard: "11th", subject: "Science" }));
    assert.throws(() => bank.readScope({ course: "Foundation", standard: "9th", subject: "Science", source: "pyq" }));
  });
});

describe("Competitive scopes", () => {
  test("JEE has Mathematics but not Biology; NEET the reverse", () => {
    assert.ok(comp({ subject: "Mathematics" }));
    assert.throws(() => comp({ subject: "Biology" }));
    assert.ok(comp({ exam: "NEET", subject: "Biology" }));
    assert.throws(() => comp({ exam: "NEET", subject: "Mathematics" }));
    assert.throws(() => comp({ exam: undefined }));
    assert.throws(() => comp({ standard: "9th" }));
  });

  test("regular questions: MCQs only, source-less included, copies and numericals out", async () => {
    const got = (await found(comp())).sort();
    assert.ok(got.includes(ids.phys) && got.includes(ids.physJee20) && got.includes(ids.physBitsat));
    assert.ok(!got.includes(ids.physNum) && !got.includes(ids.physCopy));
    assert.ok(!got.includes(ids.bio) && !got.includes(ids.f10s));
    assert.equal((await bank.scopeOptions(comp())).total, got.length);
  });

  test("NEET Biology includes Botany and Zoology names", async () => {
    const got = await found(comp({ exam: "NEET", standard: "12th", subject: "Biology" }));
    assert.ok(got.includes(ids.bio) && got.includes(ids.botany));
  });

  test("chapters, then topics of the chosen chapters only", async () => {
    const all = await bank.scopeOptions(comp());
    assert.ok(all.chapters.some((c) => c.name === "Optics") && all.chapters.some((c) => c.name === "Kinematics"));
    const kin = await bank.scopeOptions(comp({ chapters: ["kinematics"] }));
    assert.ok(kin.chapters.some((c) => c.name === "Optics"), "chapters stay listed while one is chosen");
    assert.ok(kin.topics.every((t) => t.chapter === "Kinematics"));
    assert.ok(kin.topics.some((t) => t.name === "Velocity"));
    const topic = await found(comp({ chapters: ["Kinematics"], topics: ["velocity"] }));
    assert.ok(topic.includes(ids.phys) && !topic.includes(ids.physJee20));
  });
});

describe("PYQs", () => {
  test("JEE PYQs: only sources naming JEE with a year and no other exam", async () => {
    const got = (await found(comp({ source: "pyq" }))).sort();
    assert.deepEqual(got, idsOf("physJee20", "physJee21"));
  });

  test("NEET PYQs never include JEE questions; unrelated and mixed sources are out", async () => {
    const got = await found(comp({ exam: "NEET", source: "pyq" }));
    assert.deepEqual(got, [ids.physNeet19]);
    for (const key of ["physBitsat", "physMht", "physMixed", "physJeeBitsat", "physNoYear", "physWbjee"]) {
      assert.ok(!(await found(comp({ source: "pyq" }))).includes(ids[key]), `${key} isn't a JEE PYQ`);
      assert.ok(!(await found(comp({ exam: "NEET", source: "pyq" }))).includes(ids[key]));
    }
  });

  test("IIT-JEE counts for JEE", async () => {
    assert.deepEqual(await found(comp({ subject: "Mathematics", source: "pyq" })), [ids.mathJee]);
  });

  test("years are listed with counts and filter the questions", async () => {
    const options = await bank.scopeOptions(comp({ source: "pyq" }));
    assert.deepEqual(options.years, [{ name: "2021", count: 1 }, { name: "2020", count: 1 }]);
    assert.equal(options.total, 2);
    assert.deepEqual(await found(comp({ source: "pyq", years: ["2021"] })), [ids.physJee21]);
    assert.equal((await bank.scopeOptions(comp({ source: "pyq", years: ["2021"] }))).total, 1);
    assert.equal((await bank.scopeOptions(comp({ source: "pyq", years: ["2021"] }))).years.length, 2, "years stay listed while one is chosen");
  });

  test("the source classifier", () => {
    assert.equal(bank.pyqExamOf("JEE MAIN 2020"), "JEE");
    assert.equal(bank.pyqExamOf("AIPMT 2014"), "NEET");
    assert.equal(bank.pyqExamOf("BITSAT 2018"), null);
    assert.equal(bank.pyqExamOf("JEE MAIN 2020, NEET 2019"), null);
    assert.equal(bank.pyqExamOf(""), null);
    assert.equal(bank.yearOf("NEET 2019"), "2019");
  });
});

describe("selection", () => {
  test("paging never returns more than asked and reports the real total", async () => {
    const scope = comp();
    const total = (await bank.scopeOptions(scope)).total;
    const first = await bank.pageOfQuestions(scope, 1, 2);
    assert.equal(first.questions.length, 2);
    assert.equal(first.total, total);
    assert.equal(first.hasMore, total > 2);
  });

  test("random picks stay in scope, are unique, honour exclude and never exceed what exists", async () => {
    const scope = comp();
    const total = (await bank.scopeOptions(scope)).total;
    const some = await bank.randomQuestions(scope, 3, []);
    assert.equal(some.found, 3);
    assert.equal(new Set(some.questions.map((d) => String(d._id))).size, 3);
    const all = await bank.randomQuestions(scope, 300, []);
    assert.equal(all.found, total);
    const skipped = await bank.randomQuestions(scope, 300, [ids.phys]);
    assert.ok(!skipped.questions.some((d) => String(d._id) === ids.phys));
    assert.ok(!all.questions.some((d) => [ids.physNum, ids.physCopy, ids.bio].includes(String(d._id))));
  });

  test("exact ids are verified against the scope, in order; outsiders are dropped", async () => {
    const result = await bank.verifyQuestions(comp(), [ids.physJee20, ids.bio, ids.phys, ids.physNum, ids.physJee20]);
    assert.deepEqual(result.questions.map((d) => String(d._id)), [ids.physJee20, ids.phys]);
    assert.equal(result.dropped, 2);
    const pyq = await bank.verifyQuestions(comp({ source: "pyq" }), [ids.phys, ids.physJee21]);
    assert.deepEqual(pyq.questions.map((d) => String(d._id)), [ids.physJee21], "a regular question isn't a PYQ");
  });
});
