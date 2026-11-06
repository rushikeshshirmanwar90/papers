// Phase 2A: a student's test session — start once, save, resume with the same
// deadline, score on expiry or Close Now. Runs the real route handlers against
// a throwaway in-memory MongoDB.
// Run with: npm test
import assert from "node:assert/strict";
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
    Question: (await import("@/models/Question")).default,
    TestRoom: (await import("@/models/TestRoom")).default,
    TestAttempt: (await import("@/models/TestAttempt")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};




async function seed() {
  const { Tuition, User, Batch, Question, auth } = m;
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
  ids.batch = String(batch._id);
  ids.teacher = String(teacher._id);
  ids.tuition = String(tuition._id);

  await Question.insertMany(
    ["One", "Two", "Three"].map((word, i) => ({
      paperId: tuition._id,
      questionNumber: i + 1,
      examCategory: "JEE/NEET",
      subject: "Physics",
      standard: "11th",
      chapter: "Kinematics",
      topic: "Motion",
      questionText: `Question ${word}`,
      optionA: "1",
      optionB: "2",
      optionC: "3",
      optionD: "4",
      correctAnswer: "ABC"[i],
      explanation: `Solution ${word}`,
    }))
  );

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
  json(await m.answersRoute.PUT(req("PUT", `/api/tests/${id}/answers`, who, { answers }), { params: { id } }), status);
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
  process.env.MONGODB_DB = "phase2a_test_session";
  process.env.JWT_SECRET = "phase2a-test-jwt-secret-0123456789abcdef";
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


async function createManaged(extra: Record<string, unknown> = {}, status = 200) {
 const batch2 = await m.Batch.findOne({ tuitionId: ids.tuition, name: '12 JEE' });
 const r = await m.listRoute.POST(req('POST', '/api/tests', 'teacher', { batchIds: [ids.batch, String(batch2._id), ids.batch], title: 'Access test', subject: 'Physics', durationMinutes: 60, startNow: true, closesAt: new Date(Date.now()+2*HOUR).toISOString(), questions: [{ questionText: 'Fixture', correctAnswer: 'A', optionA: '1' }], ...extra }), { params: {} });
 return json(r, status);
}
async function access(id: string, who: string, action: string, studentId?: string, status=200) {
 const route = await import('@/app/api/tests/[id]/access/route');
 return json(await route.POST(req('POST', '/api/tests/'+id+'/access', who, {action, studentId}), {params:{id}}), status);
}
describe('Phase 1 test audiences', () => {
 test('one room for deduplicated batches; default publication roster; unique attempt', async()=>{
  const {test:t}=await createManaged(); const doc=await m.TestRoom.findById(t.id);
  assert.equal(doc.batchIds.length,2); assert.equal(doc.roster.length,4); assert.ok(doc.roster.every((r: {allowed:boolean})=>r.allowed));
  await Promise.all([start(t.id),start(t.id)]); assert.equal((await attemptsOf(t.id)).length,1);
  await start(t.id,'s4');
 });
 test('selected only, exclusions, restricted detail and direct endpoint bypasses',async()=>{
  const {test:t}=await createManaged({audienceMode:'selected',studentIds:[ids.s1]});
  const detail=await view(t.id,'s2'); assert.deepEqual(detail.questions,[]); assert.equal(detail.access.allowed,false);
  await start(t.id,'s2',403); await save(t.id,[],'s2',403); await submit(t.id,{},'s2',403);
  const e=await createManaged({excludedStudentIds:[ids.s1]}); await start(e.test.id,'s1',403);
 });
 test('requests are idempotent, declined, approved, directly granted and revoked',async()=>{
  const {test:t}=await createManaged({audienceMode:'selected',studentIds:[ids.s1]});
  await Promise.all([access(t.id,'s2','request'),access(t.id,'s2','request')]);
  const doc=await m.TestRoom.findById(t.id); assert.equal(doc.roster.filter((r:{studentId:unknown;request:string})=>String(r.studentId)===ids.s2&&r.request==='pending').length,1);
  await access(t.id,'teacher','decline',ids.s2); await start(t.id,'s2',403);
  await access(t.id,'s2','request'); await access(t.id,'teacher','approve',ids.s2); await start(t.id,'s2');
  await access(t.id,'teacher','revoke',ids.s2,409);
  await access(t.id,'teacher','grant',ids.s3); await access(t.id,'teacher','revoke',ids.s3); await start(t.id,'s3',403);
 });
 test('restricted tests stay visible; teacher receives requests and controls the right to start', async () => {
  const { test: t } = await createManaged({ audienceMode: 'selected', studentIds: [ids.s1] });
  const listed = await json(await m.listRoute.GET(req('GET', '/api/tests?upcoming=1', 's2'), { params: {} }), 200);
  const visible = listed.tests.find((item: { id: string }) => item.id === t.id);
  assert.ok(visible);
  assert.equal(visible.access.allowed, false);
  assert.equal(visible.access.canRequest, true);
  await start(t.id, 's2', 403);
  await access(t.id, 's2', 'request');
  assert.equal((await view(t.id, 's2')).access.request, 'pending');
  const monitorRoute = await import('@/app/api/tests/[id]/monitor/route');
  const monitor = await json(await monitorRoute.GET(req('GET', '/api/tests/'+t.id+'/monitor', 'teacher'), { params: { id: t.id } }), 200);
  assert.ok(monitor.accessStudents.some((row: { student: { id: string }; request: string }) => row.student.id === ids.s2 && row.request === 'pending'));
  await access(t.id, 'teacher', 'decline', ids.s2);
  assert.equal((await view(t.id, 's2')).access.request, 'declined');
  await start(t.id, 's2', 403);
  await access(t.id, 's2', 'request');
  await access(t.id, 'teacher', 'approve', ids.s2);
  assert.equal((await view(t.id, 's2')).access.allowed, true);
  await start(t.id, 's2');
 });
 test('late approved starts shorten to closing; legacy cutoff remains',async()=>{
  const {test:t}=await createManaged({excludedStudentIds:[ids.s2]});
  await m.TestRoom.updateOne({_id:t.id},{closesAt:new Date(Date.now()+40*MIN)});
  await access(t.id,'teacher','grant',ids.s2); const out=await start(t.id,'s2');
  assert.ok(new Date(out.attempt.deadline).getTime()-Date.now()<=40*MIN);
  await start(await room({closesAt:new Date(Date.now()+40*MIN)}),'s1',400);
 });
 test('post-publication admission is restricted until explicit grant; invited students excluded',async()=>{
  await m.User.updateOne({_id:ids.s3},{accountStatus:'invited'});
  const {test:t}=await createManaged(); const doc=await m.TestRoom.findById(t.id); assert.ok(!doc.roster.some((r:{studentId:unknown})=>String(r.studentId)===ids.s3));
  await start(t.id,'s3',403);
  await m.User.updateOne({_id:ids.s3},{accountStatus:'active'}); await start(t.id,'s3',403);
  await access(t.id,'teacher','grant',ids.s3); await start(t.id,'s3');
 });
 test('cross-institute batches, students, requests and subject bypasses fail',async()=>{
  const foreign=await m.Batch.findOne({tuitionId:{$ne:ids.tuition}});
  await createManaged({batchIds:[ids.batch,String(foreign._id)]},404);
  await createManaged({subject:'Chemistry'},400);
  const {test:t}=await createManaged(); await view(t.id,'s5',404); await access(t.id,'s5','request',undefined,404);
  await access(t.id,'teacher','grant',ids.s5,404);
  await createManaged({studentIds:[ids.s5]},400);
 });
 test('membership changes preserve ongoing save, submit and historical results',async()=>{
  const {test:t}=await createManaged(); await start(t.id);
  const batch=await m.Batch.create({tuitionId:ids.tuition,name:'Moved batch',track:'JEE',subjects:['Physics']});
  await m.User.updateOne({_id:ids.s1},{batchId:batch._id});
  await save(t.id,[{index:0,selected:'A'}]); await submit(t.id); const attempt=(await attemptsOf(t.id))[0];
  const id=String(attempt.studentId); await view(t.id,'s1'); assert.equal(id,ids.s1);
  await m.User.updateOne({_id:ids.s1},{batchId:ids.batch});
 });
 test('closed tests reject requests and grants',async()=>{
  const {test:t}=await createManaged({excludedStudentIds:[ids.s2]});await closeNow(t.id);
  await access(t.id,'s2','request',undefined,400);await access(t.id,'teacher','grant',ids.s2,400);
 });
});

test('restricted students cannot use events, monitor or results; no-batch users cannot discover tests', async()=>{
 const {test:t}=await createManaged({excludedStudentIds:[ids.s2]});
 for (const path of ['monitor','results']) {
  const handler=path==='monitor' ? await import('@/app/api/tests/[id]/monitor/route') : await import('@/app/api/tests/[id]/results/route');
  await json(await handler.GET(req('GET','/api/tests/'+t.id+'/'+path,'s2'),{params:{id:t.id}}),403);
 }
 const events=await import('@/app/api/tests/[id]/events/route');await json(await events.POST(req('POST','/api/tests/'+t.id+'/events','s2',{type:'away',awayMs:0}),{params:{id:t.id}}),403);
 await m.User.updateOne({_id:ids.s2},{batchId:null});
 const listed=await json(await m.listRoute.GET(req('GET','/api/tests?upcoming=1','s2'),{params:{}}),200);assert.ok(!listed.tests.some((x: {id:string}) => x.id === t.id));
 await m.User.updateOne({_id:ids.s2},{batchId:ids.batch});
});
test('teacher must teach the subject in every selected batch',async()=>{
 const b=await m.Batch.create({tuitionId:ids.tuition,name:'Unauthorized Physics',track:'JEE',subjects:['Physics','Chemistry'],teachers:[{teacherId:ids.teacher,subject:'Chemistry'}]});
 await createManaged({batchIds:[ids.batch,String(b._id)]},403);
});
test('selected-only roster, restricted chip/list, exact grants and existing attempts', async () => {
 const { test: t } = await createManaged({ audienceMode: 'selected', studentIds: [ids.s1] });
 const stored = await m.TestRoom.findById(t.id);
 assert.equal(stored.accessVersion, 1);
 assert.equal(stored.audienceMode, 'selected');
 assert.deepEqual(stored.roster.filter((r: { allowed: boolean }) => r.allowed).map((r: { studentId: unknown }) => String(r.studentId)), [ids.s1]);
 await start(t.id, 's2', 403);
 await start(t.id, 's1');
 const before = await attemptsOf(t.id);
 const monitorRoute = await import('@/app/api/tests/[id]/monitor/route');
 const readMonitor = async () => json(await monitorRoute.GET(req('GET', '/api/tests/'+t.id+'/monitor', 'teacher'), { params: { id: t.id } }), 200);
 const monitor = await readMonitor();
 const mobileHelpers = new URL('../../pcmb-paper/src/screens/teacher/test-management.ts', import.meta.url).href;
 const { matchesAccess, participationCounts, availableParticipationGroups } = await import(mobileHelpers);
 const typed = monitor as { accessStudents: { student: { id: string; name: string }; batch?: { name: string } }[] };
 const restricted = typed.accessStudents!.filter(r => matchesAccess(r, 'restricted'));
 assert.equal(participationCounts(typed).restricted, 3);
 assert.deepEqual(restricted.map(r => r.student.id).sort(), [ids.s2, ids.s3, ids.s4].sort());
 assert.ok(restricted.every(r => r.student.name && r.batch?.name));
 assert.ok(!restricted.some(r => r.student.id === ids.s1));
 await access(t.id, 'teacher', 'grant', ids.s2);
 await access(t.id, 'teacher', 'grant', ids.s2);
 const saved = await m.TestRoom.findById(t.id);
 assert.deepEqual(saved.roster.filter((r: { allowed: boolean }) => r.allowed).map((r: { studentId: unknown }) => String(r.studentId)).sort(), [ids.s1, ids.s2].sort());
 assert.deepEqual(await attemptsOf(t.id), before);
 await start(t.id, 's3', 403);
 const legacyId = await room();
 const legacy = await json(await monitorRoute.GET(req('GET', '/api/tests/'+legacyId+'/monitor', 'teacher'), { params: { id: legacyId } }), 200);
 assert.equal(participationCounts(legacy).restricted, 0);
 assert.ok(availableParticipationGroups(legacy).some((r: { key: string }) => r.key === 'restricted'));
 assert.ok(availableParticipationGroups({ ...legacy, accessStudents: undefined }).some((r: { key: string }) => r.key === 'restricted'));
});

test('explicit selected audience never falls back to batch access when version metadata is missing', async () => {
 const { test: t } = await createManaged({ audienceMode: 'selected', studentIds: [ids.s1] });
 await m.TestRoom.updateOne({ _id: t.id }, { $unset: { accessVersion: 1 } });
 const restricted = await view(t.id, 's2');
 assert.equal(restricted.access.allowed, false);
 assert.equal(restricted.access.canRequest, true);
 await start(t.id, 's2', 403);
 await start(t.id, 's1');
 await createManaged({ studentIds: [ids.s1] }, 400);
});

test('batch deletion and student removal preserve test and attempt IDs and scores', async()=>{
 const admin=await m.User.create({email:'admin-history@test.local',name:'Admin',passwordHash:'x',role:'tuition',tuitionId:ids.tuition,emailVerified:true});tokens.admin=await m.auth.signToken(admin);
 const {test:t}=await createManaged(); await start(t.id);await submit(t.id,{answers:[{index:0,selected:'A'}]});
 const before=await m.TestAttempt.findOne({testId:t.id,studentId:ids.s1}).lean();
 const remove=await import('@/app/api/tuition/students/[id]/route');
 await json(await remove.DELETE(req('DELETE','/api/tuition/students/'+ids.s1,'admin'),{params:{id:ids.s1}}),200);
 const batchDelete=await import('@/app/api/tuition/batches/[id]/route');
 await json(await batchDelete.DELETE(req('DELETE','/api/tuition/batches/'+ids.batch,'admin'),{params:{id:ids.batch}}),200);
 assert.ok(await m.TestRoom.exists({_id:t.id}));const after=await m.TestAttempt.findById(before!._id).lean();assert.deepEqual(after,before);
});

