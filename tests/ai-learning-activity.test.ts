import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { fixtures, AS_OF } from './fixtures/ai-learning.mjs';
import { calculate } from '../src/lib/ai-learning/intelligence.mjs';

test('practice links require the exact exam, class and topic and exclude broken/copy questions', async () => {
  const server = await MongoMemoryServer.create();
  try {
    process.env.MONGODB_URI = server.getUri();
    process.env.MONGODB_DB = 'companion_activity_test';
    await mongoose.connect(server.getUri(), { dbName: process.env.MONGODB_DB });
    const db = mongoose.connection.db!;
    const { learningActivity } = await import('../src/lib/ai-learning/activity');
    const { clearPracticeCache } = await import('../src/lib/practice');
    const data = fixtures(), student = { ...data.students[1], synthetic: false };
    const profile = calculate(student, data.assessments, data.mappings, AS_OF);
    const originalArea = profile.subtopics[0];
    const parts = JSON.parse(originalArea.key) as string[];
    const area = { ...originalArea, subject: parts[1], standard: parts[2], chapter: parts[3], topic: parts[4], subtopic: '' };
    // Bank-aligned topic identity, no unverified child mapping.
    area.key = JSON.stringify([student.examVersion, area.subject, '11', area.chapter, area.topic, '']);
    profile.subtopics = [area];
    const question = { standard: '11th', subject: 'Physics', chapter: area.chapter, topic: area.topic, source: 'JEE MAIN 2024', answerType: 'MCQ', examCategory: 'JEE/NEET', questionText: 'Complete stem?', optionA: '1', optionB: '2', optionC: '3', optionD: '4', correctAnswer: 'A', difficulty: 'Easy' };
    await db.collection('questions').insertMany([
      { ...question, source: 'NEET 2024' }, { ...question, standard: '12th' }, { ...question, topic: 'A similarly named topic' },
      { ...question, bankCopy: true }, { ...question, reviewFlags: { options: ['broken'] } },
    ]);
    clearPracticeCache();
    const missing = await learningActivity(db, profile, area.key);
    assert.equal(missing.available, false); assert.equal(missing.place, null);
    await db.collection('questions').insertOne(question);
    clearPracticeCache();
    const available = await learningActivity(db, profile, area.key);
    assert.equal(available.available, true);
    assert.equal(available.assessmentAvailable, false, 'a single practice question cannot form a self assessment');
    assert.deepEqual(available.place, { subject: 'Physics', standard: '11th', chapter: area.chapter, topic: area.topic });
    assert.equal('questions' in available, false, 'real bank answers must use existing authorized practice APIs');
    const template: Record<string, unknown> = { ...question };
    delete template._id; // insertOne added an _id to `question`; copies need their own
    await db.collection('questions').insertMany(Array.from({ length: 4 }, () => ({ ...template })));
    assert.equal((await learningActivity(db, profile, area.key)).assessmentAvailable, true);
  } finally { await mongoose.disconnect(); await server.stop(); }
});
