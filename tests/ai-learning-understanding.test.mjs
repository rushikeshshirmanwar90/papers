import test from 'node:test';
import assert from 'node:assert/strict';
import { understandingOf } from '../src/lib/ai-learning/companion.mjs';

const area = over => ({ classification: 'strong', accuracy: 90, confidence: 1, recentAccuracy: 90, trend: 'stable', daysSinceEvidence: 3, hardAttempted: 6, hardCorrect: 5, ...over });

test('no confident level without sufficient evidence', () => {
  assert.equal(understandingOf(area({ classification: 'needs diagnosis' })), null);
  assert.equal(understandingOf(area({ classification: 'not studied', accuracy: null })), null);
});
test('four levels from accuracy and consistency', () => {
  assert.equal(understandingOf(area({ classification: 'weak', accuracy: 30 })).name, 'Foundation');
  assert.equal(understandingOf(area({ classification: 'developing', accuracy: 55 })).name, 'Developing');
  assert.equal(understandingOf(area({ accuracy: 75 })).name, 'Proficient');
  assert.equal(understandingOf(area()).name, 'Advanced');
});
test('advanced requires steady, recent, mistake-free evidence', () => {
  assert.equal(understandingOf(area({ hardAttempted: 0, hardCorrect: 0 })).name, 'Proficient', 'no reliable difficulty evidence');
  assert.equal(understandingOf(area({ hardAttempted: 6, hardCorrect: 2 })).name, 'Proficient', 'weak on hard questions');
  assert.equal(understandingOf(area({ confidence: 0.4 })).name, 'Proficient');
  assert.equal(understandingOf(area({ trend: 'declining' })).name, 'Proficient');
  assert.equal(understandingOf(area({ daysSinceEvidence: 60 })).name, 'Proficient');
  assert.equal(understandingOf(area(), { repeatedQuestions: [{ count: 2 }] }).name, 'Proficient');
});
