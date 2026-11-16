import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { exactLearningNode, learningDifficulties, learningQualityFilter, validSandboxQuestion } from '../src/lib/ai-learning/practice-policy';
test('difficulty is selected from understanding, including insufficient evidence', () => {
  assert.deepEqual(learningDifficulties('Foundation'), ['Easy']);
  assert.deepEqual(learningDifficulties('Developing'), ['Easy', 'Medium']);
  assert.deepEqual(learningDifficulties('Proficient'), ['Medium', 'Hard']);
  assert.deepEqual(learningDifficulties('Advanced'), ['Hard']);
  assert.deepEqual(learningDifficulties(null), ['Easy', 'Medium']);
});
test('exact identity never substitutes a different class/chapter/topic or unverified child', () => {
  const area = { subject: 'Physics', standard: '11', chapter: 'Motion', topic: 'Vectors' };
  const cell = ['jee-v1', 'Physics', '11', 'Motion', 'Vectors', ''];
  assert.deepEqual(exactLearningNode(area, JSON.stringify(cell)), { ...area, standard: '11th' });
  for (const [index, value] of [[1, 'Chemistry'], [2, '12'], [3, 'Other chapter'], [4, 'Vector products'], [5, 'Unverified subtopic']] as const) {
    const changed = [...cell]; changed[index] = value;
    assert.equal(exactLearningNode(area, JSON.stringify(changed)), null);
  }
  assert.equal(exactLearningNode(area, '{broken'), null);
});
test('Mongo quality predicate excludes blank/missing options, bad keys, unsupported types and missing figures', async () => {
  const server = await MongoMemoryServer.create();
  const client = new MongoClient(server.getUri());
  try {
    await client.connect(); const collection = client.db('learning_quality_test').collection('questions');
    const q = { name: 'valid', questionText: 'A valid stem?', optionA: 'one', optionB: 'two', optionC: 'three', optionD: 'four', correctAnswer: 'B', answerType: 'MCQ', difficulty: 'Easy' };
    await collection.insertMany([
      q, { ...q, name: 'blank', questionText: '  ' }, { ...q, name: 'option', optionB: '' }, { ...q, name: 'key', correctAnswer: 'AB' },
      { ...q, name: 'type', answerType: 'Descriptive' }, { ...q, name: 'hard', difficulty: 'Hard' },
      { ...q, name: 'missing-figure', questionText: 'As shown in the figure, find x.' },
      { ...q, name: 'bad-asset', optionB: '', optionDiagramUrls: { B: ['not-a-url'] } },
      { ...q, name: 'figure-option', optionB: '', optionDiagramUrls: { B: ['https://example.test/b.png'] } },
      { ...q, name: 'number', answerType: 'Numerical', correctAnswer: '-2.5e2' },
      { ...q, name: 'bad-number', answerType: 'Numerical', correctAnswer: 'NaN' },
      { ...q, name: 'overflow-number', answerType: 'Numerical', correctAnswer: '1e9999' },
    ]);
    const rows = await collection.find(learningQualityFilter('Foundation')).project({ name: 1 }).toArray();
    assert.deepEqual(rows.map(x => x.name).sort(), ['figure-option', 'number', 'valid']);
    assert.equal(await collection.countDocuments({ ...learningQualityFilter('Advanced'), name: 'hard' }), 1);
  } finally { await client.close(); await server.stop(); }
});
test('synthetic questions are complete supported saved items, never invented to fill gaps', () => {
  assert(!validSandboxQuestion({ questionText: 'Missing key', sourceId: 'a', answerType: 'MCQ' }));
  assert(validSandboxQuestion({ questionText: 'Number?', sourceId: 'n', answerType: 'Numerical', correctAnswer: '2' }));
});
