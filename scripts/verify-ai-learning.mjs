// HTTP acceptance against an explicitly local Next server. Tokens are short-lived,
// held only in memory, and never logged or written. Existing accounts are read,
// never logged in via the mutating password endpoint or edited.
import { createRequire } from 'node:module';
import { SignJWT } from 'jose';
import mongoose from 'mongoose';
import { digest } from '../src/lib/ai-learning/profiles.mjs';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.AI_VERIFY_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw Error('Verification requires a local HTTP server.');
const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
const checks = [];
async function http(path, status = 200, options = {}) {
  const start = Date.now();
  const res = await fetch(`${origin}/api${path}`, { ...options, signal: AbortSignal.timeout(60000) });
  const body = res.status === 204 ? null : await res.json();
  if (res.status !== status) throw Error(`${path}: expected HTTP ${status}, received ${res.status}`);
  checks.push({ path, status, ms: Date.now() - start });
  return body;
}
async function main() {
  await client.connect();
  const uriDb = new URL(process.env.MONGODB_URI).pathname.slice(1);
  const db = client.db(process.env.MONGODB_DB || uriDb || 'pcmb');
  if (db.databaseName !== 'pcmb') throw Error('Verification requires the configured pcmb database.');
  for (const path of ['/auth/me', '/syllabus?subject=Physics&standard=11th', '/pyq/topics?subject=Physics&standard=11th&chapter=Units', '/self-assessments', '/textbooks', '/ai-learning/me/profile', '/ai-learning/students']) await http(path, 401);
  const issued = await http('/ai-learning/demo/session', 200, { method: 'POST', headers: { 'X-AI-Learning-Local': '1' } });
  const demo = { headers: { Authorization: `Bearer ${issued.token}` } };
  const { students } = await http('/ai-learning/students', 200, demo);
  if (students.length !== 10 || students.some(s => !s.synthetic)) throw Error('Synthetic roster mismatch.');
  const profileChecks = [];
  for (const student of students) {
    const profile = await http(`/ai-learning/students/${student.studentId}/profile`, 200, demo);
    const stored = await db.collection('ai_learning_profiles').findOne({ studentId: student.studentId, synthetic: true, tuitionId: null });
    if (digest(profile) !== digest(stored.data)) throw Error(`Profile mismatch: ${student.studentId}`);
    const count = await db.collection('ai_learning_history').countDocuments({ synthetic: true, studentId: student.studentId });
    if (count !== (student.studentId === 'synthetic-10' ? 1 : 6) || profile.history.length !== count) throw Error('Historical assessment count mismatch.');
    for (const view of ['subjects', 'topics', 'mastery', 'areas', 'history', 'recommendations', 'revision-recommendations', 'mistakes']) await http(`/ai-learning/students/${student.studentId}/${view}`, 200, demo);
    profileChecks.push({ studentId: student.studentId, assessments: count, classification: profile.summary.classification, trend: profile.summary.trend, profileMatches: true });
  }
  await http('/ai-learning/students/unknown/profile', 404, demo);
  await http('/ai-learning/me/profile', 401, demo); // Demo bearer cannot authenticate as a real student.
  await http('/ai-learning/demo/session', 403, { method: 'POST', headers: { 'X-AI-Learning-Local': '1', Origin: 'https://example.org' } });
  const catalog = await http('/textbooks', 200, demo);
  if (catalog.total !== 8) throw Error('Textbook count mismatch.');
  let chapterCount = 0, topicCount = 0, flatCount = 0;
  for (const entry of catalog.textbooks) {
    const book = await http(`/textbooks/${entry.id}`, 200, demo);
    chapterCount += book.chapters.length; topicCount += book.chapterScopedTopicCount; flatCount += book.bookLevelTopicCount;
    if (book.contentAvailability !== 'metadata-only') throw Error('Textbook content incorrectly advertised.');
  }
  if (chapterCount !== 106 || topicCount !== 699 || flatCount !== 634) throw Error('Textbook metadata counts differ.');
  const selected = await http('/textbooks?class=11&subject=Physics', 200, demo);
  const book = await http(`/textbooks/${selected.textbooks[0].id}`, 200, demo), chapter = book.chapters[0];
  await http(`/textbooks/${book.id}/chapters/${chapter.code}`, 200, demo);
  await http(`/textbooks/${book.id}/chapters/${chapter.code}/topics`, 200, demo);
  if (chapter.topics.length) await http(`/textbooks/${book.id}/chapters/${chapter.code}/topics/${encodeURIComponent(chapter.topics[0].topicNumber)}`, 200, demo);
  await http('/textbooks/search?q=Introduction&limit=10', 200, demo);
  await http('/textbooks?class=10', 400, demo);
  const candidates = await db.collection('users').find({ role: 'student', active: true, mustChangePassword: { $ne: true }, tuitionId: { $ne: null } }, { projection: { _id: 1, tuitionId: 1, role: 1, tokenVersion: 1 } }).limit(20).toArray();
  let realStudentVerified = false;
  for (const user of candidates) {
    if (!await db.collection('tuitions').findOne({ _id: user.tuitionId, active: true }, { projection: { _id: 1 } })) continue;
    const jwt = await new SignJWT({ role: user.role, tid: String(user.tuitionId), v: user.tokenVersion }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(user._id)).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const auth = { headers: { Authorization: `Bearer ${jwt}` } };
    await http('/auth/me', 200, auth);
    await http('/syllabus?subject=Physics&standard=11th', 200, auth);
    await http('/pyq/topics?subject=Physics&standard=11th&chapter=Units%20and%20Measurements', 200, auth);
    await http('/self-assessments', 200, auth);
    await http('/textbooks?class=11&subject=Physics', 200, auth);
    const profile = await http('/ai-learning/me/profile', 200, auth);
    if (profile.student.studentId !== String(user._id) || profile.student.synthetic) throw Error('Personal profile identity mismatch.');
    const scoped = await http('/ai-learning/me/profile?studentId=synthetic-01&tuitionId=foreign', 200, auth);
    if (scoped.student.studentId !== String(user._id)) throw Error('Query changed authorization scope.');
    for (const view of ['mastery', 'recommendations', 'history', 'mistakes']) await http(`/ai-learning/me/${view}`, 200, auth);
    await http('/ai-learning/students/synthetic-01/profile', 401, auth);
    realStudentVerified = true;
    break;
  }
  if (!realStudentVerified) throw Error('No eligible existing student was available for authenticated read verification.');
  console.log(JSON.stringify({ origin, database: 'pcmb', realStudentVerified, profileChecks, textbooks: { books: catalog.total, chapters: chapterCount, chapterTopics: topicCount, bookTopics: flatCount }, checks }, null, 2));
}
try { await main(); }
catch (error) { console.error(error.name === 'Error' ? error.message : `Verification failed (${error.name}); private details suppressed.`); process.exitCode = 1; }
finally { await client.close(); }
