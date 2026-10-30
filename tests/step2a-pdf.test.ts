// Step 2A tests for POST /api/question-paper-pdf: who may make PDFs, request
// checks, and that Chrome is cleaned up when printing fails or hangs. Real
// PDFs are printed with the local Chrome; failures use a stand-in browser.
// Runs against a throwaway in-memory MongoDB. Run with: npm test
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { SignJWT } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Browser } from "puppeteer-core";
import { NextRequest } from "next/server";

const JWT_SECRET = "step2a-test-jwt-secret-0123456789abcdef";
const BASE = "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform as string];
const haveChrome = !!CHROME && existsSync(CHROME);

let mongod: MongoMemoryServer;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [pdfRoute, render, auth, db] = await Promise.all([
    import("@/app/api/question-paper-pdf/route"),
    import("@/lib/questionPaper/render"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    pdfRoute,
    render,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
  };
}

const tokens: Record<string, string> = {};

async function seed() {
  const { Tuition, User, auth } = m;
  const [open, closed] = await Tuition.create([{ name: "Open tuition" }, { name: "Closed tuition", active: false }]);
  const user = (email: string, role: string | null, tuitionId: unknown, extra: Record<string, unknown> = {}) =>
    User.create({ email, name: email, passwordHash: "x", role, tuitionId, emailVerified: true, ...extra });
  const teacher = await user("teacher@test.local", "teacher", open._id);
  const owner = await user("owner@test.local", "tuition", open._id);
  const student = await user("student@test.local", "student", open._id);
  const loner = await user("loner@test.local", null, null);
  const disabled = await user("disabled@test.local", "teacher", open._id, { active: false });
  const closedTeacher = await user("closed@test.local", "teacher", closed._id);
  const signedOut = await user("signedout@test.local", "teacher", open._id);
  for (const [name, u] of Object.entries({ teacher, owner, student, loner, disabled, closedTeacher, signedOut })) tokens[name] = await auth.signToken(u);
  // A password change raises tokenVersion: older tokens stop working.
  await User.updateOne({ _id: signedOut._id }, { $inc: { tokenVersion: 1 } });
  tokens.expired = await new SignJWT({ role: "teacher", tid: String(open._id), v: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(teacher._id))
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(JWT_SECRET));
  tokens.forged = await new SignJWT({ role: "teacher", tid: String(open._id), v: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(teacher._id))
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("some-other-secret-that-is-long-enough-123"));
}

// ─── Requests ──────────────────────────────────────────────────────────────

/** A paper as the Expo app sends it (services/question-pdf.ts requestBody). */
function appPaper(questionCount = 2, extra: Record<string, unknown> = {}) {
  return {
    title: "Kinematics test",
    standard: "11th",
    subject: "Physics",
    marksPerQuestion: 4,
    answerKey: true,
    solutions: false,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      questionText: `A body moves with $v = ${i + 2}t^2$. Find $a$ at $t = 1$.`,
      optionA: `$${i}$`,
      optionB: "$2$",
      optionC: "$\\frac{1}{2}$",
      optionD: "$\\sqrt{3}$",
      answerType: "MCQ",
      correctAnswer: "B",
      explanation: "",
      chapter: "Kinematics",
      diagramUrls: [],
      optionDiagramUrls: { A: [], B: [], C: [], D: [] },
      explanationDiagramUrls: [],
    })),
    ...extra,
  };
}

function post(who: string | null, body: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", ...headers };
  if (who) h.authorization = `Bearer ${tokens[who] ?? who}`;
  const req = new NextRequest(`${BASE}/api/question-paper-pdf`, {
    method: "POST",
    headers: h,
    body: typeof body === "string" || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
  });
  return m.pdfRoute.POST(req, {});
}

async function expectError(res: Response, status: number) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}`);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.equal(typeof body.error, "string");
  return body;
}

// ─── A stand-in browser, to make printing fail or hang on purpose ──────────

type Behaviour = { pdf?: "fail" | "hang"; close?: "hang" };

function fakeBrowser(behaviour: Behaviour) {
  const stats = { launched: 0, pagesOpened: 0, pagesClosed: 0, browserClosed: 0, killed: 0 };
  const launch = async () => {
    stats.launched++;
    let connected = true;
    // Like Puppeteer: when Chrome goes away, calls still waiting on it fail.
    const waiting: ((error: Error) => void)[] = [];
    const disconnect = () => {
      connected = false;
      waiting.splice(0).forEach((reject) => reject(new Error("Target closed")));
    };
    const browser = {
      get connected() {
        return connected;
      },
      async newPage() {
        stats.pagesOpened++;
        return {
          async setJavaScriptEnabled() {},
          async setRequestInterception() {},
          on() {},
          async goto() {},
          pdf: () =>
            behaviour.pdf === "fail"
              ? Promise.reject(new Error("Protocol error (Page.printToPDF): Printing failed /secret/path"))
              : behaviour.pdf === "hang"
              ? new Promise<Uint8Array>((_, reject) => waiting.push(reject))
              : Promise.resolve(new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n"))),
          async close() {
            stats.pagesClosed++;
          },
        };
      },
      close: () => {
        stats.browserClosed++;
        if (behaviour.close === "hang") return new Promise<void>(() => {});
        disconnect();
        return Promise.resolve();
      },
      process: () => ({
        kill: () => {
          stats.killed++;
          disconnect();
          return true;
        },
      }),
    };
    return browser as unknown as Browser;
  };
  return { stats, launch };
}

// ─── Setup ─────────────────────────────────────────────────────────────────

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "step2a_pdf_test";
  process.env.JWT_SECRET = JWT_SECRET;
  m = await load();
  await m.db.connectDB();
  await seed();
});

after(async () => {
  await m?.render.setBrowserLauncherForTests(null); // closes any Chrome still open
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

// ─── Who may make PDFs ─────────────────────────────────────────────────────

describe("authentication and roles", () => {
  test("anonymous requests are refused (401)", async () => {
    await expectError(await post(null, appPaper()), 401);
  });
  test("malformed, forged and expired tokens are refused (401)", async () => {
    await expectError(await post("not-a-jwt", appPaper()), 401);
    await expectError(await post("forged", appPaper()), 401);
    await expectError(await post("expired", appPaper()), 401);
  });
  test("a token from before a password change is refused (401)", async () => {
    await expectError(await post("signedOut", appPaper()), 401);
  });
  test("a turned-off account is refused (401)", async () => {
    await expectError(await post("disabled", appPaper()), 401);
  });
  test("a teacher of a turned-off tuition is refused (401)", async () => {
    await expectError(await post("closedTeacher", appPaper()), 401);
  });
  test("students are refused (403)", async () => {
    await expectError(await post("student", appPaper()), 403);
  });
  test("accounts not in a tuition are refused (403)", async () => {
    await expectError(await post("loner", appPaper()), 403);
  });
  test("the login is checked before the body is read: an anonymous huge body is a 401, not a 413", async () => {
    await expectError(await post(null, "x".repeat(5 * 1024 * 1024)), 401);
  });
});

// ─── Request checks (answered before any printing) ─────────────────────────

describe("request validation", () => {
  test("bodies that aren't a paper are refused (400)", async () => {
    await expectError(await post("teacher", "{not json"), 400);
    await expectError(await post("teacher", "[]"), 400);
    await expectError(await post("teacher", appPaper(0)), 400);
    await expectError(await post("teacher", appPaper(1, { marksPerQuestion: "4" })), 400);
    await expectError(await post("teacher", appPaper(1, { questions: ["not a question"] })), 400);
    await expectError(await post("teacher", appPaper(1, { title: { $gt: "" } })), 400);
  });
  test("more than 300 questions are refused (400)", async () => {
    const body = await expectError(await post("teacher", appPaper(301)), 400);
    assert.match(body.error, /300/);
  });
  test("a paper with too many figures is refused (400)", async () => {
    const paper = appPaper(60);
    paper.questions.forEach((q, i) => {
      q.diagramUrls = Array.from({ length: 11 }, (_, j) => `https://vedclass-cdn.s3.ap-south-1.amazonaws.com/${i}-${j}.png`) as never;
    });
    const body = await expectError(await post("teacher", paper), 400);
    assert.match(body.error, /at most 600/);
  });
  test("an oversized body is cut off without a Content-Length (413)", async () => {
    await expectError(await post("teacher", "x".repeat(5 * 1024 * 1024)), 413);
  });
  test("an oversized Content-Length is refused up front (413)", async () => {
    await expectError(await post("teacher", appPaper(), { "content-length": String(50 * 1024 * 1024) }), 413);
  });
});

// ─── Real PDFs ─────────────────────────────────────────────────────────────

describe("PDF generation", { skip: haveChrome ? false : "Chrome isn't installed here (set CHROME_PATH)" }, () => {
  test("an authenticated Expo-shaped request from a teacher gets a real PDF", { timeout: 120000 }, async () => {
    const res = await post("teacher", appPaper(3));
    assert.equal(res.status, 200, `got ${res.status}: ${res.status === 200 ? "" : await res.clone().text()}`);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-disposition") ?? "", /filename\*=UTF-8''Kinematics%20test\.pdf/);
    const pages = Number(res.headers.get("x-page-count"));
    assert.ok(pages >= 2, "paper plus answer key page");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), pages);
  });
  test("a tuition account can make a PDF too", { timeout: 120000 }, async () => {
    const res = await post("owner", appPaper(1, { answerKey: false }));
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  });
});

// ─── Failures and cleanup (stand-in browser) ───────────────────────────────

describe("rendering failures and cleanup", () => {
  after(() => m.render.setBrowserLauncherForTests(null));

  test("a print failure is a plain 500 with no internal detail, and the page is closed", async () => {
    const fake = fakeBrowser({ pdf: "fail" });
    await m.render.setBrowserLauncherForTests(fake.launch);
    const body = await expectError(await post("teacher", appPaper()), 500);
    assert.equal(body.error, "Could not make the PDF. Try again.");
    assert.equal(body.detail, undefined);
    assert.doesNotMatch(JSON.stringify(body), /secret|Protocol/);
    assert.equal(fake.stats.pagesClosed, fake.stats.pagesOpened, "every page closed");
  });

  test("a print that hangs times out, and Chrome is closed so nothing keeps running", async () => {
    const fake = fakeBrowser({ pdf: "hang" });
    await m.render.setBrowserLauncherForTests(fake.launch);
    await assert.rejects(m.render.renderPdf("<p>x</p>", 300), m.render.RenderTimeoutError);
    assert.equal(fake.stats.browserClosed, 1, "browser closed on timeout");
    assert.equal(fake.stats.pagesClosed, fake.stats.pagesOpened, "page closed");
  });

  test("a Chrome that won't close is killed", { timeout: 20000 }, async () => {
    const fake = fakeBrowser({ pdf: "hang", close: "hang" });
    await m.render.setBrowserLauncherForTests(fake.launch);
    await assert.rejects(m.render.renderPdf("<p>x</p>", 300), m.render.RenderTimeoutError);
    assert.equal(fake.stats.killed, 1);
  });

  test("after a timeout the next paper starts a fresh browser and prints", async () => {
    const hanging = fakeBrowser({ pdf: "hang" });
    await m.render.setBrowserLauncherForTests(hanging.launch);
    await assert.rejects(m.render.renderPdf("<p>x</p>", 300), m.render.RenderTimeoutError);
    const working = fakeBrowser({});
    await m.render.setBrowserLauncherForTests(working.launch);
    const pdf = await m.render.renderPdf("<p>x</p>", 5000);
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
    assert.equal(working.stats.launched, 1);
  });

  test("too many waiting papers are turned away, and the line clears afterwards", async () => {
    const fake = fakeBrowser({ pdf: "hang" });
    await m.render.setBrowserLauncherForTests(fake.launch);
    const waiting = Array.from({ length: 4 }, () => m.render.renderPdf("<p>x</p>", 400));
    await assert.rejects(m.render.renderPdf("<p>x</p>", 400), m.render.RenderBusyError);
    for (const p of waiting) await assert.rejects(p, m.render.RenderTimeoutError);
    await m.render.setBrowserLauncherForTests(fakeBrowser({}).launch);
    await m.render.renderPdf("<p>x</p>", 5000); // accepted again
  });

  test("the endpoint answers 503 when too many papers are waiting", async () => {
    const fake = fakeBrowser({ pdf: "hang" });
    await m.render.setBrowserLauncherForTests(fake.launch);
    const waiting = Array.from({ length: 4 }, () => m.render.renderPdf("<p>x</p>", 400));
    await expectError(await post("teacher", appPaper()), 503);
    for (const p of waiting) await assert.rejects(p, m.render.RenderTimeoutError);
  });
});
