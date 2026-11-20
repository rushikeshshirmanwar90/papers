import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { personalProfile, digest } from '../src/lib/ai-learning/profiles.mjs';

test('real Mongo snapshots isolate tenants, invalidate released evidence and preserve source records', async () => {
  const server = await MongoMemoryReplSet.create({ replSet: { count: 1, configSettings: { electionTimeoutMillis: 3000 } } });
  let connection;
  try {
    const uri = server.getUri();
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
    connection = await mongoose.createConnection(uri, { dbName: 'ai_learning_test' }).asPromise();
    const db = connection.db;
    const oid = () => new mongoose.Types.ObjectId();
    const studentId = oid(), tuitionId = oid(), otherStudent = oid(), otherTuition = oid(), testId = oid();
    const account = { userId: String(studentId), tuitionId: String(tuitionId), user: { standard: '11th', program: 'NEET' } };
    const scope = { studentId, tuitionId };
    const date = new Date(Date.now() - 86400000);
    const question = { sourceId: String(oid()), standard: '11th', subject: 'Physics', chapter: 'Motion', topic: 'Speed', questionText: 'Snapshot', answerType: 'MCQ', correctAnswer: 'A' };
    const assessment = { ...scope, submittedAt: date, createdAt: date, updatedAt: date, questions: [question], answers: [{ index: 0, selected: 'B', correct: true }], correctCount: 1, score: 4, maxScore: 4 };
    await db.collection('selfassessments').insertMany([
      { ...assessment }, { ...assessment, studentId: otherStudent }, { ...assessment, tuitionId: otherTuition },
      { ...assessment, submittedAt: null },
    ]);
    await db.collection('testrooms').insertOne({ _id: testId, tuitionId, opensAt: date, closesAt: date, updatedAt: date, questions: [{ ...question, sourceId: String(oid()) }] });
    await db.collection('testattempts').insertMany([
      { ...scope, testId, submittedAt: date, suspendedAt: null, rev: 1, answers: [{ index: 0, selected: 'B', correct: false }] },
      { studentId: otherStudent, tuitionId, testId, submittedAt: null, suspendedAt: date },
    ]);
    const sources = ['selfassessments', 'testrooms', 'testattempts'];
    const sourceDigest = async () => digest(await Promise.all(sources.map(name => db.collection(name).find().sort({ _id: 1 }).toArray())));
    const before = await sourceDigest();
    const blocked = await personalProfile(connection, account);
    assert.equal(blocked.evidence.selfAssessments, 1);
    assert.equal(blocked.evidence.releasedTeacherAttempts, 0);
    assert.equal(blocked.summary.correct, 1, 'persisted correctness wins over the answer key');
    assert.equal(blocked.history.length, 1);
    assert.equal(await sourceDigest(), before, 'AI reads must not finalize or edit any source assessment');

    // Change only this disposable test fixture to exercise a release and then a recall.
    await db.collection('testattempts').updateOne({ studentId: otherStudent }, { $set: { submittedAt: date, suspendedAt: null } });
    const released = await personalProfile(connection, account);
    assert.equal(released.evidence.releasedTeacherAttempts, 1);
    assert.equal(released.history.length, 2);
    assert.equal(released.summary.wrong, 1);
    await db.collection('testattempts').updateOne({ studentId: otherStudent }, { $set: { submittedAt: null, suspendedAt: date } });
    const recalled = await personalProfile(connection, account);
    assert.equal(recalled.history.length, 1, 'an otherwise fresh AI cache must not retain recalled results');
    assert.equal(recalled.summary.wrong, 0);

    const foreign = await personalProfile(connection, { ...account, userId: String(oid()), tuitionId: String(otherTuition) });
    assert.equal(foreign.history.length, 0);
    assert.equal(foreign.summary.asked, 0);
    const caches = await db.collection('ai_learning_profiles').find().toArray();
    assert.equal(caches.length, 2);
    assert(caches.every(row => !row.synthetic && row.data.student.studentId === row.studentId));

    const senior = await personalProfile(connection, { ...account, user: { ...account.user, standard: '12th' } });
    assert.equal(senior.summary.asked, 0, 'Class 11 answers must not change Class 12 mastery');
    assert.equal(senior.history.length, 0, 'earlier-class attempts stay out of current-class history');
    assert.equal(senior.foundationAreas.length, 1, 'earlier-class revision remains available separately');
    assert.equal(senior.foundationAreas[0].standard, '11');
  } finally {
    await connection?.close();
    await server.stop();
  }
});
