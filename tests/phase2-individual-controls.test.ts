// Phase 2A: a student's test session — start once, save, resume with the same
// deadline, score on expiry or Close Now. Runs the real route handlers against
// a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";
const MIN = 60_000;
const HOUR = 60 * MIN;

let mongod: MongoMemoryReplSet;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [listRoute, overviewRoute, testRoute, startRoute, answersRoute, submitRoute, auth, db] = await Promise.all([
    import("@/app/api/tests/route"),
    import("@/app/api/student/overview/route"),
    import("@/app/api/tests/[id]/route"),
    import("@/app/api/tests/[id]/start/route"),
    import("@/app/api/tests/[id]/answers/route"),
    import("@/app/api/tests/[id]/submit/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    listRoute,
    visibility: await import("@/app/api/tests/[id]/visibility/route"),
    controls: await import("@/app/api/tests/[id]/attempt-control/route"),
    events: await import("@/app/api/tests/[id]/events/route"),
    monitor: await import("@/app/api/tests/[id]/monitor/route"),
    status: await import("@/app/api/tests/[id]/status/route"),
    results: await import("@/app/api/tests/[id]/results/route"),
    overviewRoute,
    testRoute,
    startRoute,
    answersRoute,
    submitRoute,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};


async function seed() {
  const { Tuition, User, Batch, auth } = m;
  const tuition = await Tuition.create({ name: "Tuition A" });
  const other = await Tuition.create({ name: "Tuition B" });
  const user = (email: string, role: string, t = tuition) => User.create({ email, name: email, passwordHash: "x", role, tuitionId: t._id, emailVerified: true });
  const teacher = await user("teacher@test.local", "teacher");
  const batch = await Batch.create({ tuitionId: tuition._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const batch2 = await Batch.create({ tuitionId: tuition._id, name: "12 JEE", track: "JEE", subjects: ["Physics"], teachers: [{ teacherId: teacher._id, subject: "Physics" }] });
  const otherBatch = await Batch.create({ tuitionId: other._id, name: "11 JEE", track: "JEE", subjects: ["Physics"], teachers: [] });
  for (const [key, batchDoc, t] of [
    ["s1", batch, tuition],
    ["s2", batch, tuition],
    ["s3", batch, tuition],
    ["s4", batch2, tuition],
    ["s5", otherBatch, other],
  ] as const) {
    const u = await user(`${key}@test.local`, "student", t);
    await User.updateOne({ _id: u._id }, { batchId: batchDoc._id });
    tokens[key] = await auth.signToken((await User.findById(u._id))!);
    ids[key] = String(u._id);
  }
  tokens.teacher = await auth.signToken(teacher);
  for (const [key, role, tenant] of [["admin", "tuition", tuition], ["outsider", "teacher", other], ["colleague", "teacher", tuition]] as const) {
    const account = await user(`${key}@test.local`, role, tenant);
    tokens[key] = await auth.signToken(account);
  }
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);
  ids.tuition = String(tuition._id);


}

/** A test room made directly, so its times can be anything. Answers: A, B, C. */
async function room(over: { opensAt?: Date; closesAt?: Date; durationMinutes?: number; batchId?: string } = {}) {
  const q = (word: string, correctAnswer: string) => ({
    subject: "Physics",
    questionText: `Question ${word}`,
    optionA: "1",
    optionB: "2",
    optionC: "3",
    optionD: "4",
    correctAnswer,
    explanation: `Solution ${word}`,
  });
  const doc = await m.TestRoom.create({
    tuitionId: ids.tuition,
    batchId: over.batchId ?? ids.batch,
    teacherId: ids.teacher,
    title: "Session test",
    subject: "Physics",
    questions: [q("One", "A"), q("Two", "B"), q("Three", "C")],
    marksPerQuestion: 4,
    negativeMarks: 1,
    durationMinutes: over.durationMinutes ?? 60,
    opensAt: over.opensAt ?? new Date(Date.now() - HOUR),
    closesAt: over.closesAt ?? new Date(Date.now() + 5 * HOUR),
  });
  return String(doc._id);
}

function req(method: string, path: string, who: string, body?: unknown) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status: number) {
  const body = await res.json();
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const start = async (id: string, who = "s1", status = 200) => json(await startRaw(id, who), status);
const startRaw = (id: string, who = "s1") => m.startRoute.POST(req("POST", `/api/tests/${id}/start`, who), { params: { id } });
const save = async (id: string, answers: unknown, who = "s1", status = 200) =>
  json(await m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, who, { answers, resumeVersion: 0 }), { params: { id } }), status);
const submit = async (id: string, body: unknown = {}, who = "s1", status = 200) =>
  json(await m.submitRoute.POST(req("POST", `/api/tests/${id}/submit`, who, body), { params: { id } }), status);
const view = async (id: string, who: string, status = 200) => json(await m.testRoute.GET(req("GET", `/api/tests/${id}`, who), { params: { id } }), status);
const closeNow = async (id: string, status = 200) => json(await m.testRoute.PATCH(req("PATCH", `/api/tests/${id}`, "teacher", { closeNow: true }), { params: { id } }), status);
const attemptsOf = (id: string) => m.TestAttempt.find({ testId: id }).lean<{ studentId: unknown; startedAt: Date; submittedAt: Date | null; score: number; answers: { index: number; selected: string | null }[] }[]>();

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "phase2_individual_controls";
  process.env.JWT_SECRET = "phase2-controls-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await m.TestAttempt.init(); // the unique index must exist before the concurrency tests
  await seed();
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

const controlRaw = (id: string, body: Record<string, unknown>, who = 'teacher') => m.controls.POST(req('POST', `/api/tests/${id}/attempt-control`, who, body), { params: { id } });
const control = (id: string, action: string, extra: Record<string, unknown> = {}, status = 200, who = 'teacher') =>
  controlRaw(id, { studentId: ids.s1, action, requestId: randomUUID(), ...extra }, who).then(res => json(res, status));
const event = (id: string, version = 0) => m.events.POST(req('POST', `/api/tests/${id}/events`, 's1', { type: 'away', awayMs: 15000, resumeVersion: version }), { params: { id } }).then(res => json(res, 200));
const snapshot = (id: string) => m.status.GET(req('GET', `/api/tests/${id}/status`, 's1'), { params: { id } }).then(res => json(res, 200));
const stored = (id: string, who = 's1') => m.TestAttempt.findOne({ testId: id, studentId: ids[who] });
const changeAttempt = (id: string, change: Record<string, unknown>) => m.TestAttempt.updateOne({ testId: id, studentId: ids.s1 }, { $set: change });
const closeSchedule = (id: string) => m.TestRoom.updateOne({ _id: id }, { closesAt: new Date(Date.now() - MIN) });
const rejectResults = (id: string) => m.results.GET(req('GET', `/api/tests/${id}/results`, 'teacher'), { params: { id } }).then(res => json(res, 409));

describe('individual deadline extensions', () => {
  test('quick and custom amounts are additive, audited, isolated and idempotent', async () => {
    const id = await room();
    const first = (await start(id)).attempt;
    const peer = (await start(id, 's2')).attempt;
    for (const minutes of [5, 10, 15, 30, 7]) {
      const requestId = randomUUID();
      const payload = { studentId: ids.s1, action: 'extend', requestId, minutes };
      const replies = await Promise.all([controlRaw(id, payload), controlRaw(id, payload)]);
      for (const reply of replies) await json(reply, 200);
    }
    const attempt = await stored(id);
    assert.equal(attempt.individualDeadline.getTime(), new Date(first.deadline).getTime() + 67 * MIN);
    assert.equal(attempt.controls.length, 5);
    assert.ok(attempt.controls.every((c: { teacherId: unknown; at: Date }) => String(c.teacherId) === ids.teacher && c.at instanceof Date));
    assert.equal((await start(id, 's2')).attempt.deadline, peer.deadline);
    assert.equal((await start(id)).attempt.id, first.id);
  });

  test('concurrent distinct extensions do not lose increments', async () => {
    const id = await room(); const first = (await start(id)).attempt;
    await Promise.all([5, 10, 15].map(minutes => control(id, 'extend', { minutes })));
    assert.equal((await stored(id)).individualDeadline.getTime(), new Date(first.deadline).getTime() + 30 * MIN);
  });

  test('invalid custom minutes and request reuse with changed payload are refused', async () => {
    const id = await room(); await start(id);
    for (const minutes of [0, -5, 1.5, 121, '5', null]) await control(id, 'extend', { minutes }, 400);
    const requestId = randomUUID();
    await control(id, 'extend', { minutes: 5, requestId });
    await control(id, 'extend', { minutes: 10, requestId }, 409);
  });

  test('students, non-creators and cross-institute teachers cannot extend or resume', async () => {
    const id = await room(); await start(id);
    for (const action of ['extend', 'resume']) {
      await control(id, action, { minutes: 5 }, 403, 's1');
      await control(id, action, { minutes: 5 }, 404, 'outsider');
      await control(id, action, { minutes: 5 }, 404, 'colleague');
    }
    await control(id, 'extend', { minutes: 5 }, 200, 'admin');
  });

  test('extended attempts continue after normal close, save, extend again, and keep results hidden', async () => {
    const id = await room(); await start(id); await start(id, 's2'); await control(id, 'extend', { minutes: 5 });
    await closeSchedule(id);
    await save(id, [{ index: 0, selected: 'A' }], 's2', 400);
    await save(id, [{ index: 0, selected: 'A' }]);
    await control(id, 'extend', { minutes: 10 });
    const home = await json(await m.overviewRoute.GET(req('GET', '/api/student/overview', 's1'), {}), 200);
    assert.ok(home.openTests.some((t: { id: string }) => t.id === id));
    const response = await view(id, 's1');
    assert.equal(response.test.status, 'open');
    assert.equal(response.questions[0].correctAnswer, undefined);
    await rejectResults(id);
    await start(id, 's3', 400);
    await submit(id);
    assert.equal((await view(id, 's1')).test.status, 'closed');
  });

  test('effective expiry rejects saving, extensions and resume', async () => {
    const id = await room(); await start(id);
    await changeAttempt(id, { individualDeadline: new Date(Date.now() - MIN) });
    await save(id, [{ index: 0, selected: 'A' }], 's1', 400);
    await control(id, 'extend', { minutes: 5 }, 409);
    await control(id, 'resume', {}, 409);
  });

  test('extension versus expiry rechecks the current deadline', async () => {
    const id = await room(); await start(id);
    const { finalize } = await import('@/lib/attempts');
    const testDoc = await m.TestRoom.findById(id);
    const stale = await stored(id);
    await control(id, 'extend', { minutes: 15 });
    const oldExpiry = new Date(stale.startedAt.getTime() + 60 * MIN + 1);
    const result = await finalize(testDoc, stale, oldExpiry, true);
    assert.equal(result.submittedAt, null);
  });

  test('extension versus submission never reopens or overwrites the result', async () => {
    const id = await room(); await start(id); await save(id, [{ index: 0, selected: 'A' }]);
    const replies = await Promise.all([controlRaw(id, { studentId: ids.s1, action: 'extend', minutes: 5, requestId: randomUUID() }), m.submitRoute.POST(req('POST', `/api/tests/${id}/submit`, 's1', {}), { params: { id } })]);
    assert.ok([200, 409].includes(replies[0].status)); assert.equal(replies[1].status, 200);
    assert.ok((await stored(id)).submittedAt); assert.equal((await stored(id)).score, 4);
    await control(id, 'extend', { minutes: 5 }, 409);
  });
});

describe('violation suspension and teacher resolution', () => {
  test('suspends without scoring, blocks saves/submission and preserves evidence and answers', async () => {
    const id = await room(); const first = (await start(id)).attempt;
    await save(id, [{ index: 1, selected: 'B' }]);
    const paused = (await event(id)).attempt;
    assert.equal(paused.state, 'suspended'); assert.equal(paused.result, null);
    assert.equal(paused.id, first.id); assert.ok(paused.remainingMs > 0);
    const attempt = await stored(id);
    assert.equal(attempt.submittedAt, null); assert.equal(attempt.events.length, 1); assert.equal(attempt.events[0].ended, true);
    assert.equal(attempt.answers[0].selected, 'B'); assert.equal(attempt.answers[0].correct, null);
    await save(id, [{ index: 1, selected: 'A' }], 's1', 409);
    await submit(id, {}, 's1', 409);
    await control(id, 'extend', { minutes: 5 }, 409);
  });

  test('teacher resume restores remaining time after close, same attempt/answers/history; old evidence is acknowledged', async () => {
    const id = await room(); const original = (await start(id)).attempt;
    await save(id, [{ index: 1, selected: 'B' }]);
    const paused = (await event(id)).attempt;
    await start(id, 's2'); await control(id, 'extend', { studentId: ids.s2, minutes: 30 }); // an active extension keeps the test live
    await closeSchedule(id);
    assert.equal((await view(id, 'teacher')).test.status, 'open'); await rejectResults(id);
    const home = await json(await m.overviewRoute.GET(req('GET', '/api/student/overview', 's1'), {}), 200);
    assert.ok(home.openTests.some((t: { id: string }) => t.id === id));
    const low = Date.now(); const requestId = randomUUID();
    await Promise.all([control(id, 'resume', { suspendedAt: paused.suspendedAt, requestId }), control(id, 'resume', { suspendedAt: paused.suspendedAt, requestId })]);
    const resumed = (await snapshot(id)).attempt;
    assert.equal(resumed.id, original.id); assert.equal(resumed.state, 'in-progress');
    assert.ok(new Date(resumed.deadline).getTime() >= low + paused.remainingMs);
    assert.ok(new Date(resumed.deadline).getTime() <= Date.now() + paused.remainingMs);
    assert.equal(resumed.answers[0].selected, 'B'); assert.equal((await stored(id)).events.length, 1);
    assert.equal((await stored(id)).controls.filter((c: { action: string }) => c.action === 'resume').length, 1);
    assert.equal((await attemptsOf(id)).length, 2); // s1 (one attempt, resumed) and s2
    await event(id, 0); assert.equal((await snapshot(id)).attempt.state, 'in-progress');
    await json(await m.answersRoute.PUT(req('PUT', `/api/tests/${id}/answers`, 's1', { answers: [{ index: 0, selected: 'A' }], resumeVersion: resumed.resumeVersion }), { params: { id } }), 200);
    await event(id, resumed.resumeVersion);
    assert.equal((await snapshot(id)).attempt.state, 'suspended'); assert.equal((await stored(id)).events.length, 2);
  });

  test('ordinary submissions and legacy violation submissions cannot reopen', async () => {
    for (const endedReason of [null, 'violation']) {
      const id = await room(); await start(id); await submit(id);
      await changeAttempt(id, { endedReason });
      const before = await stored(id);
      await control(id, 'resume', {}, 409);
      assert.equal((await stored(id)).submittedAt.getTime(), before.submittedAt.getTime());
      assert.equal((await stored(id)).score, before.score);
    }
  });

  test('resume/finalization race admits one teacher decision and preserves historical answers', async () => {
    const id = await room(); await start(id); await save(id, [{ index: 0, selected: 'A' }]);
    const paused = (await event(id)).attempt;
    const replies = await Promise.all(['resume', 'finalize'].map(action => controlRaw(id, { studentId: ids.s1, action, requestId: randomUUID(), suspendedAt: paused.suspendedAt })));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
    assert.equal((await stored(id)).controls.length, 1);
    assert.equal((await stored(id)).answers[0].selected, 'A');
  });

  test('finalized violation resolution completes the test and releases results without resetting scores', async () => {
    const id = await room(); await start(id); await save(id, [{ index: 0, selected: 'A' }]);
    const paused = (await event(id)).attempt;
    await control(id, 'finalize', { suspendedAt: paused.suspendedAt }); await closeSchedule(id);
    await control(id, 'resume', { suspendedAt: paused.suspendedAt }, 409);
    assert.equal((await view(id, 'teacher')).test.status, 'closed');
    assert.equal((await stored(id)).score, 4);
    assert.equal((await snapshot(id)).questions[0].correctAnswer, 'A');
    await json(await m.results.GET(req('GET', `/api/tests/${id}/results`, 'teacher'), { params: { id } }), 200);
  });

  test('manual end hard-stops extended and suspended attempts, including concurrent resume', async () => {
    const id = await room(); await start(id); await start(id, 's2');
    await control(id, 'extend', { studentId: ids.s2, minutes: 30 });
    const paused = (await event(id)).attempt;
    await Promise.all([closeNow(id), controlRaw(id, { studentId: ids.s1, action: 'resume', requestId: randomUUID(), suspendedAt: paused.suspendedAt })]);
    assert.ok((await attemptsOf(id)).every(a => a.submittedAt));
    assert.equal((await view(id, 'teacher')).test.status, 'closed');
    await control(id, 'resume', { suspendedAt: paused.suspendedAt }, 409);
    await control(id, 'extend', { studentId: ids.s2, minutes: 5 }, 409);
    await save(id, [{ index: 0, selected: 'A' }], 's2', 400);
  });
});

describe('violation auto-submission at final completion', () => {
  const suspendS1 = async (id: string) => {
    await start(id); await save(id, [{ index: 0, selected: 'A' }]);
    return (await event(id)).attempt;
  };
  const extendS2 = async (id: string) => { await start(id, 's2'); await control(id, 'extend', { studentId: ids.s2, minutes: 30 }); };

  test('suspended attempt is submitted at normal close with saved answers, history kept, no resume', async () => {
    const id = await room(); const paused = await suspendS1(id); await closeSchedule(id);
    assert.equal((await view(id, 'teacher')).test.status, 'closed');
    const a = await stored(id);
    assert.ok(a.submittedAt); assert.equal(a.submittedAt.getTime(), new Date(paused.suspendedAt).getTime());
    assert.equal(a.suspendedAt, null); assert.equal(a.score, 4); assert.equal(a.answers[0].selected, 'A');
    assert.equal(a.events.length, 1); assert.equal(a.endedReason, 'violation');
    await control(id, 'resume', { suspendedAt: paused.suspendedAt }, 409);
    await json(await m.results.GET(req('GET', `/api/tests/${id}/results`, 'teacher'), { params: { id } }), 200);
  });

  test('active extension keeps the test live; suspended attempt stays resolvable and results stay hidden', async () => {
    const id = await room(); const paused = await suspendS1(id); await extendS2(id); await closeSchedule(id);
    assert.equal((await view(id, 'teacher')).test.status, 'open');
    assert.equal((await stored(id)).submittedAt, null);
    await rejectResults(id);
    assert.equal((await snapshot(id)).questions?.[0]?.correctAnswer, undefined);
    await control(id, 'resume', { suspendedAt: paused.suspendedAt }); // teacher resolution before completion
    assert.equal((await stored(id)).suspendedAt, null);
  });

  test('last extended student submitting finalizes the suspended attempt and completes the test', async () => {
    const id = await room(); await suspendS1(id); await extendS2(id); await closeSchedule(id);
    await submit(id, {}, 's2');
    assert.ok((await stored(id)).submittedAt); assert.equal((await stored(id)).score, 4);
    assert.equal((await view(id, 'teacher')).test.status, 'closed');
  });

  test('extended student expiring finalizes the suspended attempt', async () => {
    const id = await room(); await suspendS1(id); await extendS2(id); await closeSchedule(id);
    await m.TestAttempt.updateOne({ testId: id, studentId: ids.s2 }, { individualDeadline: new Date(Date.now() - 1000) });
    assert.equal((await view(id, 'teacher')).test.status, 'closed');
    assert.ok((await stored(id)).submittedAt);
  });

  test('concurrent and repeated completion reads finalize exactly once without changing the score', async () => {
    const id = await room(); await suspendS1(id); await closeSchedule(id);
    await Promise.all([1, 2, 3].map(() => view(id, 'teacher')));
    const first = await stored(id);
    await view(id, 'teacher'); await snapshot(id);
    const again = await stored(id);
    assert.equal(again.submittedAt.getTime(), first.submittedAt.getTime());
    assert.equal(again.score, first.score); assert.equal(again.rev, first.rev);
  });

  test('manual End Test for Everyone finalizes suspended and extended attempts despite extensions', async () => {
    const id = await room(); await suspendS1(id); await extendS2(id);
    await closeNow(id);
    assert.ok((await attemptsOf(id)).every(a => a.submittedAt));
  });
});

describe('examination visibility grace and durable heartbeat', () => {
  const iso = (at: number) => new Date(at).toISOString();
  const client = 'visibility_client_0001';
  const report = (id: string, body: Record<string, unknown>, status = 200, who = 's1') =>
    m.visibility.POST(req('POST', `/api/tests/${id}/visibility`, who, body), { params: { id } }).then(res => json(res, status));
  const packet = (over: Record<string, unknown> = {}) => ({ clientId: client, sequence: 1, resumeVersion: 0, visible: true, observedAt: iso(Date.now()), interruptions: [], ...over });
  const tracked = async () => {
    const id = await room(); await start(id);
    await changeAttempt(id, { startedAt: new Date(Date.now() - MIN) });
    await report(id, packet());
    return id;
  };
  const oldLease = (id: string, at: number, interruption: unknown = null) => changeAttempt(id, {
    visibility: { clientId: client, sequence: 1, lastSeenAt: new Date(at), retiredClients: [], interruption },
  });

  test('all visibility reasons have the same inclusive 10-second grace without changing the deadline', async () => {
    for (const reason of ['app-background', 'app-inactive', 'focus-loss', 'screen-focus-loss', 'split-screen']) {
      const id = await tracked(); const before = (await snapshot(id)).attempt;
      const end = Date.now();
      const interruption = { id: randomUUID(), reason, startedAt: iso(end - 10000), returnedAt: iso(end) };
      const result = await report(id, packet({ sequence: 2, observedAt: iso(end), interruptions: [interruption] }));
      assert.equal(result.attempt.state, 'in-progress'); assert.equal(result.attempt.deadline, before.deadline);
      assert.equal((await stored(id)).events[0].ended, false);
      assert.equal((await stored(id)).events[0].awayMs, 10000);
    }
  });

  test('more than 10 seconds suspends once at the grace boundary, preserves answers and remaining time', async () => {
    const id = await tracked(); await save(id, [{ index: 0, selected: 'A' }]);
    const initial = (await snapshot(id)).attempt;
    const end = Date.now() - 500; const startAt = end - 10001;
    const interruption = { id: randomUUID(), reason: 'app-background', startedAt: iso(startAt), returnedAt: iso(end) };
    const body = packet({ sequence: 2, interruptions: [interruption] });
    const replies = await Promise.all([report(id, body), report(id, body)]);
    assert.ok(replies.every(r => r.attempt.state === 'suspended'));
    const paused = await stored(id);
    assert.equal(paused.events.length, 1); assert.equal(paused.events[0].interruptionId, interruption.id);
    assert.equal(paused.suspendedAt.getTime(), startAt + 10000);
    assert.equal(paused.remainingMs, new Date(initial.deadline).getTime() - startAt - 10000);
    assert.equal(paused.answers[0].selected, 'A'); assert.equal(paused.submittedAt, null);
    await report(id, packet({ sequence: 3 }));
    assert.equal((await stored(id)).events.length, 1); assert.ok((await stored(id)).suspendedAt);
  });

  test('a persisted hidden screen suspends on status refresh even without a return callback', async () => {
    const id = await tracked(); const at = Date.now() - 11000;
    const interruption = { id: randomUUID(), reason: 'app-background', startedAt: new Date(at) };
    await oldLease(id, at, interruption);
    const paused = (await snapshot(id)).attempt;
    assert.equal(paused.state, 'suspended');
    assert.equal((await stored(id)).events[0].reason, 'app-background');
    await save(id, [{ index: 0, selected: 'B' }], 's1', 409);
    await report(id, packet({ sequence: 2, interruptions: [{ ...interruption, startedAt: iso(at), returnedAt: iso(Date.now()) }] }));
    assert.equal((await stored(id)).events.length, 1);
    assert.ok((await stored(id)).events[0].returnedAt);
    assert.equal((await snapshot(id)).attempt.state, 'suspended');
  });

  test('missing heartbeats while foregrounded never create a violation or change the attempt', async () => {
    const id = await tracked(); const original = (await snapshot(id)).attempt;
    await oldLease(id, Date.now() - 30000);
    const current = (await snapshot(id)).attempt;
    assert.equal(current.state, 'in-progress'); assert.equal(current.id, original.id);
    assert.equal(current.deadline, original.deadline);
    assert.equal((await stored(id)).events.length, 0);
    await report(id, packet({ sequence: 2 }));
    await save(id, [{ index: 0, selected: 'A' }]);
    assert.equal((await snapshot(id)).attempt.visibilityVerified, true);
    assert.equal((await stored(id)).answers[0].selected, 'A');
  });

  test('legacy blur, inactive, screen and split-window evidence cannot suspend a foreground student', async () => {
    for (const reason of ['focus-loss', 'app-inactive', 'screen-focus-loss', 'split-screen']) {
      const id = await tracked(); const at = Date.now() - 20000;
      const interruption = { id: randomUUID(), reason, startedAt: new Date(at) };
      await oldLease(id, at, interruption);
      assert.equal((await snapshot(id)).attempt.state, 'in-progress');
      const result = await report(id, packet({ sequence: 2, interruptions: [{ ...interruption, startedAt: iso(at), returnedAt: iso(Date.now()) }] }));
      assert.equal(result.attempt.state, 'in-progress');
      assert.ok((await stored(id)).events.every((event: { ended: boolean }) => !event.ended));
    }
  });

  test('reopening within grace retires the old process; delayed packets cannot overwrite the current lease', async () => {
    const id = await tracked(); await oldLease(id, Date.now() - 9000);
    const currentClient = 'visibility_client_0002';
    const reopened = await report(id, packet({ clientId: currentClient }));
    assert.equal(reopened.attempt.state, 'in-progress');
    const before = await stored(id);
    await report(id, packet({ sequence: 999, visible: false, interruptions: [{ id: randomUUID(), reason: 'app-background', startedAt: iso(Date.now()) }] }));
    const after = await stored(id);
    assert.equal(after.visibility.clientId, currentClient);
    assert.equal(after.visibility.lastSeenAt.getTime(), before.visibility.lastSeenAt.getTime());
    assert.equal(after.events.length, 0);
  });

  test('reopening after a heartbeat gap stays active without background evidence', async () => {
    const id = await tracked(); await oldLease(id, Date.now() - 11000);
    const result = await report(id, packet({ clientId: 'visibility_client_0002' }));
    assert.equal(result.attempt.state, 'in-progress');
    assert.equal((await stored(id)).events.length, 0);
  });

  test('delayed short-return evidence is safe, while an already suspended attempt never auto-resumes', async () => {
    const id = await tracked(); const at = Date.now() - 20000;
    const interruption = { id: randomUUID(), reason: 'screen-focus-loss', startedAt: new Date(at) };
    await oldLease(id, at, interruption);
    const result = await report(id, packet({ sequence: 2, interruptions: [{ ...interruption, startedAt: iso(at), returnedAt: iso(at + 9000) }] }));
    assert.equal(result.attempt.state, 'in-progress');
    assert.equal((await stored(id)).events[0].ended, false);
    const second = await tracked(); await oldLease(second, at, { id: randomUUID(), reason: 'app-background', startedAt: new Date(at) });
    assert.equal((await snapshot(second)).attempt.state, 'suspended');
    await report(second, packet({ sequence: 2, interruptions: [{ id: randomUUID(), reason: 'app-background', startedAt: iso(at), returnedAt: iso(at + 9000) }] }));
    assert.equal((await snapshot(second)).attempt.state, 'suspended');
  });

  test('out-of-order requests cannot refresh last-seen or manufacture a later interruption', async () => {
    const id = await tracked(); await report(id, packet({ sequence: 3 }));
    const before = await stored(id);
    await report(id, packet({ sequence: 2, visible: false, interruptions: [{ id: randomUUID(), reason: 'focus-loss', startedAt: iso(Date.now() - 11000) }] }));
    const after = await stored(id);
    assert.equal(after.visibility.sequence, 3); assert.equal(after.visibility.lastSeenAt.getTime(), before.visibility.lastSeenAt.getTime());
    assert.equal(after.events.length, 0);
  });

  test('normal expiry before the grace boundary remains final and cannot be reopened', async () => {
    const id = await tracked(); const at = Date.now() - 20000;
    await oldLease(id, at); await changeAttempt(id, { individualDeadline: new Date(at + 5000) });
    assert.equal((await snapshot(id)).attempt.state, 'submitted');
    await control(id, 'resume', {}, 409);
    assert.equal((await stored(id)).events.length, 0);
  });

  test('missed lifecycle evidence is resolved before completion/results; manual end remains a hard stop', async () => {
    const id = await tracked(); const at = Date.now() - 20000;
    await oldLease(id, at, { id: randomUUID(), reason: 'app-background', startedAt: new Date(at) }); await closeSchedule(id);
    // Closing is before the inferred grace boundary here: normal expiry wins.
    // Move closing after that boundary to model loss just before normal close.
    await m.TestRoom.updateOne({ _id: id }, { closesAt: new Date(Date.now() - 1000) });
    assert.equal((await view(id, 'teacher')).test.status, 'closed'); // nothing extended: the suspension is submitted at close
    assert.equal((await stored(id)).endedReason, 'violation'); assert.ok((await stored(id)).submittedAt);
    const stopped = await report(id, packet({ sequence: 2 }));
    assert.equal(stopped.attempt.state, 'submitted');
    await control(id, 'resume', {}, 409);
  });

  test('visibility endpoints preserve teacher/student and cross-institute authorization', async () => {
    const id = await tracked();
    await report(id, packet(), 403, 'teacher');
    await report(id, packet(), 404, 's5');
    await report(id, packet({ sequence: -1 }), 400);
  });

  test('new mobile starts do not infer background from a missing first heartbeat', async () => {
    const id = await room();
    await json(await m.startRoute.POST(req('POST', `/api/tests/${id}/start`, 's1', { visibility: true }), { params: { id } }), 200);
    assert.ok((await stored(id)).visibility);
    await changeAttempt(id, { startedAt: new Date(Date.now() - MIN) });
    await oldLease(id, Date.now() - 11000);
    assert.equal((await snapshot(id)).attempt.state, 'in-progress');
  });

  test('delayed saves/submissions from before teacher resume cannot overwrite or end the resumed generation', async () => {
    const id = await tracked(); await save(id, [{ index: 0, selected: 'A' }]);
    const at = Date.now() - 11000;
    await oldLease(id, at, { id: randomUUID(), reason: 'app-background', startedAt: new Date(at) });
    const paused = (await snapshot(id)).attempt;
    await control(id, 'resume', { suspendedAt: paused.suspendedAt });
    await json(await m.answersRoute.PUT(req('PUT', `/api/tests/${id}/answers`, 's1', { answers: [{ index: 0, selected: 'B' }], resumeVersion: 0 }), { params: { id } }), 409);
    await json(await m.submitRoute.POST(req('POST', `/api/tests/${id}/submit`, 's1', { answers: [{ index: 0, selected: 'B' }], resumeVersion: 0 }), { params: { id } }), 409);
    const result = await stored(id);
    assert.equal(result.submittedAt, null); assert.equal(result.answers[0].selected, 'A');
    assert.equal(result.resumeVersion, 1); assert.ok(result.visibility);
  });
});

