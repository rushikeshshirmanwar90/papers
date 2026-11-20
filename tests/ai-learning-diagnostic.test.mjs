import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures, AS_OF } from './fixtures/ai-learning.mjs';
import { calculate } from '../src/lib/ai-learning/intelligence.mjs';
import { buildCompanion } from '../src/lib/ai-learning/companion.mjs';
import { scoreAnswers } from '../src/lib/marking.ts';

// Controlled in-memory fixtures only: no assessment record is read from or written to a database.
const data = fixtures();
const student = data.students.find(s => s.studentId === 'synthetic-10');
const mine = data.assessments.filter(a => a.studentId === student.studentId);

function submitted(session, correct) {
  const base = mine[0];
  const questions = base.questions.flatMap(q => [0, 1].map(r => ({ ...q, sourceId: `${q.sourceId}:new${session}:${r}` })));
  const given = new Map(questions.map((q, i) => [i, correct ? q.correctAnswer : 'wrong']));
  const result = scoreAnswers(questions, given, 4, 1);
  return { ...base, assessmentId: `${student.studentId}:diagnostic:${session}`, submittedAt: new Date(AS_OF - (3 - session) * 86400000).toISOString(), questions, answers: result.answers, result };
}

test('a sparse student is at a starting point; unattempted areas are not weak', () => {
  const before = buildCompanion(calculate(student, mine, data.mappings, AS_OF));
  assert(before.starting);
  assert(before.areas.every(a => a.understanding === null), 'no confident level without evidence');
  assert(!before.areas.some(a => a.priority === 'Focus first'));
  assert.equal(before.roadmap.at(-1).kind, 'assessment');
});

test('a submitted assessment refreshes levels, attention topics, priorities and roadmap', () => {
  const before = buildCompanion(calculate(student, mine, data.mappings, AS_OF));
  const original = JSON.stringify(mine);
  const weakRun = buildCompanion(calculate(student, [...mine, submitted(1, false), submitted(2, false)], data.mappings, AS_OF));
  assert(!weakRun.starting);
  assert(weakRun.areas.some(a => a.understanding?.name === 'Foundation'));
  assert(weakRun.areas.some(a => a.priority === 'Focus first'));
  assert.notDeepEqual(weakRun.roadmap, before.roadmap);
  const strongRun = buildCompanion(calculate(student, [...mine, submitted(1, true), submitted(2, true)], data.mappings, AS_OF));
  assert(!strongRun.starting);
  assert(strongRun.areas.some(a => a.understanding));
  assert(strongRun.areas.every(a => a.understanding?.name !== 'Advanced'), 'no Advanced without reliable difficulty evidence');
  assert.notDeepEqual(strongRun.priorities.map(a => a.priority), weakRun.priorities.map(a => a.priority));
  assert.equal(JSON.stringify(mine), original, 'recalculation never mutates stored assessments');
});

test('every synthetic profile builds a plan whose levels are subtopic-specific and in the four-level scale', () => {
  const allowed = new Set(['Foundation', 'Developing', 'Proficient', 'Advanced', undefined]);
  for (const s of data.students) {
    const plan = buildCompanion(calculate(s, data.assessments, data.mappings, AS_OF));
    for (const a of plan.areas) {
      assert(allowed.has(a.understanding?.name));
      assert.equal(a.understanding === null, !['Building your basics', 'Getting better', 'Doing well'].includes(a.level));
    }
  }
});
