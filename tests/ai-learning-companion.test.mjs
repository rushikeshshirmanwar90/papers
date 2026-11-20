import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures, AS_OF } from './fixtures/ai-learning.mjs';
import { calculate } from '../src/lib/ai-learning/intelligence.mjs';
import { buildCompanion } from '../src/lib/ai-learning/companion.mjs';

// In-memory existing fixtures only: no synthetic records are seeded or migrated.
const data = fixtures();
const profile = id => calculate(data.students.find(s => s.studentId === id), data.assessments, data.mappings, AS_OF);
test('all ten scenarios get scoped, manageable plans without technical scores', () => {
  for (const student of data.students) {
    const p = profile(student.studentId), original = JSON.stringify(p), plan = buildCompanion(p);
    assert(plan.roadmap.length >= 3 && plan.roadmap.length <= 5);
    assert.equal(plan.priorities.length, 3);
    assert.equal(plan.subjects.length, 3);
    assert.equal(plan.subjects[2].subject, plan.exam === 'JEE' ? 'Mathematics' : 'Biology');
    assert(plan.areas.every(a => a.standard === student.standard));
    for (const a of plan.areas) {
      assert(a.reason.length > 20); assert(a.next.length > 20);
      assert.equal(a.score, undefined); assert.equal(a.confidence, undefined); assert.equal(a.accuracy, undefined);
    }
    assert.equal(JSON.stringify(p), original, 'presentation cannot mutate stored learning evidence');
    assert(!JSON.stringify(plan).includes('questionText'), 'home must not download mistake questions');
  }
});
test('strong, weak, improving, declining and sparse students receive different guidance', () => {
  const strong = buildCompanion(profile('synthetic-01')), weak = buildCompanion(profile('synthetic-02'));
  assert(strong.areas.every(a => a.level === 'Doing well'));
  assert(weak.priorities.every(a => a.priority === 'Focus first'));
  assert.notEqual(strong.roadmap[0].title, weak.roadmap[0].title);
  assert.match(buildCompanion(profile('synthetic-03')).trend, /improving/);
  const declining = buildCompanion(profile('synthetic-04'));
  assert.match(declining.areas.find(a => a.subject === 'Chemistry').reason, /less accurate/);
  const sparse = buildCompanion(profile('synthetic-10'));
  assert(sparse.starting); assert.equal(sparse.areas.filter(a => a.priority === 'Not yet studied').length, 2);
  assert(!sparse.areas.some(a => a.priority === 'Focus first'));
});
test('later evidence updates priorities without claiming that opening a task completed it', () => {
  const p = profile('synthetic-02'), before = buildCompanion(p);
  const changed = structuredClone(p);
  for (const a of changed.subtopics) { a.classification = 'strong'; a.trend = 'improving'; }
  const after = buildCompanion(changed);
  assert.notDeepEqual(after.roadmap, before.roadmap);
  assert(!after.roadmap.some(s => 'completed' in s || 'minutes' in s));
});
test('foreign exams, subjects and standards cannot enter a roadmap', () => {
  const p = profile('synthetic-02');
  const base = p.subtopics[0];
  p.subtopics.push({ ...base, key: 'foreign-exam', examVersion: 'neet-other' }, { ...base, key: 'foreign-subject', subject: 'Biology' }, { ...base, key: 'foreign-class', standard: '12' });
  assert(!buildCompanion(p).areas.some(a => a.key.startsWith('foreign')));
});
test('Class 11 revision stays explicit and unreviewed prerequisite links make no claim', () => {
  const p = profile('synthetic-04');
  p.foundationAreas = [{ ...p.subtopics[0], key: 'foundation', standard: '11' }];
  const target = p.recommendations.find(r => r.subject === p.subtopics[0].subject);
  target.prerequisites = [{ key: 'foundation', reviewStatus: 'needs-review' }];
  let plan = buildCompanion(p);
  assert(plan.areas.find(a => a.key === 'foundation').foundation);
  assert(!plan.areas.find(a => a.key === 'foundation').reason.includes('prerequisite'));
  target.prerequisites[0].reviewStatus = 'verified';
  plan = buildCompanion(p);
  assert.match(plan.areas.find(a => a.key === 'foundation').reason, /reviewed prerequisite/);
});
test('no history leads to a real diagnostic starting action with no fabricated weak areas', () => {
  const p = calculate({ ...data.students[0], synthetic: false }, [], [], AS_OF);
  const plan = buildCompanion(p);
  assert(plan.starting); assert.equal(plan.priorities.length, 0);
  assert.equal(plan.roadmap[0].action, 'Take a Quick Assessment');
  assert(plan.subjects.every(s => !s.hasEvidence && !s.attention.length));
});
test('demo activities read only that synthetic student and reject unrelated cells before querying', async () => {
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused_companion_test';
  const { learningActivity } = await import('../src/lib/ai-learning/activity.ts');
  const p = profile('synthetic-02');
  let calls = 0;
  const db = { collection(name) {
    assert.equal(name, 'ai_learning_history');
    return { find(filter) {
      calls++; assert.deepEqual(filter, { synthetic: true, tuitionId: null, studentId: p.student.studentId });
      const cursor = { sort() { return cursor; }, limit() { return cursor; }, toArray: async () => data.assessments.filter(a => a.studentId === p.student.studentId).map(data => ({ data })) };
      return cursor;
    } };
  } };
  await assert.rejects(learningActivity(db, p, 'another-student'), /current study plan/);
  assert.equal(calls, 0);
  const activity = await learningActivity(db, p, p.subtopics[0].key);
  assert(activity.available); assert(activity.questions.length > 0 && activity.questions.length <= 5);
  assert(activity.questions.every(q => q.questionText.includes('dimension')));
  assert(!JSON.stringify(activity.questions).includes('sourceId'));
  const sparse = profile('synthetic-10');
  const unavailableDb = { collection: () => ({ find: () => ({ sort() { return this; }, limit() { return this; }, toArray: async () => [] }) }) };
  assert.equal((await learningActivity(unavailableDb, sparse, sparse.notStudiedAreas[0].key)).available, false);
});
