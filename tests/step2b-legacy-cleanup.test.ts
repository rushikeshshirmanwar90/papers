// Step 2B: the old app's unauthenticated student/attempt routes are gone,
// nothing still calls them, and the data they wrote is kept and still
// counted. Runs against a throwaway in-memory MongoDB. Run with: npm test
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

const ROOT = process.cwd();
const REMOVED_ROUTES = ["src/app/api/students", "src/app/api/attempts"];
const REMOVED_URLS = /["'`/]api\/(students|attempts)(\/|["'`?]|$)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("removed legacy routes", () => {
  test("their route folders no longer exist", () => {
    for (const dir of REMOVED_ROUTES) assert.equal(existsSync(join(ROOT, dir)), false, `${dir} should be gone`);
    assert.equal(existsSync(join(ROOT, "src/lib/scoring.ts")), false);
  });

  test("no backend or app source calls them", () => {
    const dirs = [join(ROOT, "src"), join(ROOT, "scripts"), join(ROOT, "../pcmb-paper/src")].filter(existsSync);
    const callers = dirs.flatMap(sourceFiles).filter((file) => REMOVED_URLS.test(readFileSync(file, "utf8")));
    assert.deepEqual(callers, []);
  });

  test("the new app's routes are all still there", () => {
    for (const route of [
      "auth/login",
      "auth/me",
      "tuition/batches",
      "tuition/students",
      "tests",
      "tests/[id]/start",
      "tests/[id]/submit",
      "analysis/student/[id]",
      "pyq",
      "pyq/answer",
      "questions",
      "papers",
      "question-paper-pdf",
      "dashboard",
    ]) {
      assert.ok(existsSync(join(ROOT, "src/app/api", route, "route.ts")), `${route} is missing`);
    }
  });
});

describe("legacy data is kept", () => {
  let mongod: MongoMemoryServer;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DB = "step2b_cleanup_test";
  });

  after(async () => {
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect();
    await mongod?.stop();
  });

  test("the dashboard still counts old students and attempts", async () => {
    const [{ GET }, { connectDB }, Paper, Question, Attempt, Student] = await Promise.all([
      import("@/app/api/dashboard/route"),
      import("@/lib/db"),
      import("@/models/Paper").then((x) => x.default),
      import("@/models/Question").then((x) => x.default),
      import("@/models/Attempt").then((x) => x.default),
      import("@/models/Student").then((x) => x.default),
    ]);
    await connectDB();
    const paper = await Paper.create({ title: "Old paper", examType: "JEE", year: 2024, pdfUrl: "/x" });
    const question = await Question.create({ paperId: paper._id, questionNumber: 1, subject: "Physics", questionText: "Q" });
    const student = await Student.create({ name: "Old student", email: "old@test.local" });
    await Attempt.create({
      studentId: student._id,
      paperId: paper._id,
      answers: [{ questionId: question._id, selected: "A" }],
      score: 4,
      correctCount: 1,
      wrongCount: 0,
      skippedCount: 0,
      totalQuestions: 1,
    });

    const body = await (await GET()).json();
    assert.equal(body.totalPapers, 1);
    assert.equal(body.totalQuestions, 1);
    assert.equal(body.totalAttempts, 1);
    assert.equal(body.totalStudents, 1);
  });
});
