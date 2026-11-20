// Read-only live verification. No real-user JWT creation, login, seed or migration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { digest } from '../src/lib/ai-learning/profiles.mjs';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.AI_VERIFY_ORIGIN || 'http://127.0.0.1:3001';
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
const checks = [], scenarios = [];
async function request(path, status = 200, options = {}) {
  const start = Date.now();
  const result = await fetch(`${origin}/api/ai-learning/${path}`, { ...options, signal: AbortSignal.timeout(60000) });
  assert.equal(result.status, status, path);
  checks.push({ path: path.split('?')[0], status, ms: Date.now() - start });
  return result.json();
}
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || new URL(process.env.MONGODB_URI).pathname.slice(1) || 'pcmb');
  assert.equal(db.databaseName, 'pcmb');
  await db.command({ ping: 1 });
  const snapshot = async () => Promise.all(['ai_learning_profiles', 'ai_learning_history', 'ai_syllabus_mappings'].map(name => db.collection(name).find(name === 'ai_syllabus_mappings' ? {} : { synthetic: true }).sort({ _id: 1 }).toArray()));
  const before = await snapshot(), counts = before.map(rows => rows.length);
  assert.deepEqual(counts, [10, 55, 142]);
  const { token } = await request('demo/session', 200, { method: 'POST', headers: { 'X-AI-Learning-Local': '1' } });
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  for (const row of before[0]) {
    const id = row.studentId;
    const plan = await request(`students/${id}/companion`, 200, auth);
    assert.equal(plan.student.studentId, id); assert(plan.roadmap.length >= 3 && plan.roadmap.length <= 5);
    assert.equal(plan.subjects.length, 3); assert.equal(plan.subjects[2].subject, plan.exam === 'NEET' ? 'Biology' : 'Mathematics');
    assert(!('history' in plan));
    const activity = await request(`students/${id}/activity?cell=${encodeURIComponent(plan.priorities[0].key)}`, 200, auth);
    assert.equal(activity.area.key, plan.priorities[0].key); assert(activity.available); assert.equal(activity.mode, 'demo');
    scenarios.push({ id, scenario: row.student.scenario, exam: plan.exam, starting: plan.starting, priority: plan.priorities[0].priority, title: plan.roadmap[0].title, trend: plan.trend, bytes: JSON.stringify(plan).length });
    if (id === 'synthetic-10') {
      assert(plan.starting); assert(plan.areas.every(a => a.priority !== 'Focus first'));
      const empty = await request(`students/${id}/activity?cell=${encodeURIComponent(plan.areas.find(a => a.priority === 'Not yet studied').key)}`, 200, auth);
      assert.equal(empty.available, false);
    }
  }
  await request('students/synthetic-02/activity?cell=foreign', 404, auth);
  await request('me/companion', 401, auth);
  await request('students/synthetic-02/companion', 401);
  assert.equal(digest(await snapshot()), digest(before), 'No synthetic record may change');
  console.log(JSON.stringify({ origin, database: 'pcmb', counts: { students: counts[0], assessments: counts[1], mappings: counts[2] }, sourceUnchanged: true, scenarios, checks }, null, 2));
} catch (error) { console.error(`Companion verification failed: ${error.name}. Private details suppressed.`); process.exitCode = 1; }
finally { await client.close(); }
