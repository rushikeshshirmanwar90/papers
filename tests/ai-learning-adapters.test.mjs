import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { assessmentCopy, practiceCopy, realStudent, releasedRoom } from '../src/lib/ai-learning/evidence.mjs';
import { calculate, evidenceFor } from '../src/lib/ai-learning/intelligence.mjs';
import { personalProfile } from '../src/lib/ai-learning/profiles.mjs';
import { textbookMetadata, selectChapter, searchMetadata } from '../src/lib/ai-learning/textbooks.mjs';

const account = { userId: '000000000000000000000001', tuitionId: '000000000000000000000002', user: { program: 'NEET', standard: '11th' } };
const student = realStudent(account);
const question = { sourceId: 'q1', subject: 'Physics', standard: '11th', chapter: 'Motion', topic: 'Motion', questionText: 'Stored snapshot', answerType: 'MCQ', correctAnswer: 'A' };
const row = { _id: 'a1', submittedAt: new Date('2026-10-01'), questions: [question], answers: [{ index: 0, selected: 'B', correct: true }], score: 9, maxScore: 9, correctCount: 1 };

test('persisted scoring, unknown syllabus version and absent subtopic remain authoritative', () => {
  const snapshot = assessmentCopy(row, row.questions, student, 'self');
  assert.equal(snapshot.questions[0].standard, '11');
  assert.equal(snapshot.questions[0].subtopic, '');
  assert.equal(snapshot.questions[0].examVersion, 'unversioned:NEET');
  const profile = calculate(student, [snapshot], [], Date.parse('2026-11-15'));
  assert.equal(profile.summary.correct, 1, 'saved correctness is not recalculated against a changed key');
  assert.equal(profile.history[0].result.score, 9);
  assert.equal(profile.summary.classification, 'needs diagnosis');
});

test('practice latest state is deduplicated and cannot impersonate multiple test sessions', () => {
  const practice = Array.from({ length: 10 }, (_, i) => practiceCopy({ questionId: `q${i}`, subject: 'Physics', standard: '11th', chapter: 'Motion', topic: 'Motion', answeredAt: new Date('2026-10-01'), selected: 'B', correct: true }, question, student));
  const snapshot = assessmentCopy(row, row.questions, student, 'self');
  assert.equal(evidenceFor(student.studentId, [snapshot, snapshot], practice).length, 10);
  const profile = calculate(student, [], [], Date.parse('2026-11-15'), practice);
  assert.equal(profile.summary.assessmentCount, 1);
  assert.equal(profile.summary.classification, 'needs diagnosis');
});

test('NEET evidence excludes Mathematics and groups Botany under Biology without changing saved correctness', () => {
  const copy = assessmentCopy({ ...row, answers: [{ index: 0, selected: 'A', correct: true }, { index: 1, selected: 'B', correct: false }] },
    [{ ...question, subject: 'Mathematics' }, { ...question, subject: 'Botany' }], student, 'self');
  assert.equal(copy.questions.length, 1);
  assert.equal(copy.questions[0].subject, 'Biology');
  assert.deepEqual(copy.answers, [{ index: 0, selected: 'B', correct: false }]);
});

test('teacher evidence requires a closed room and no pending attempt, including suspensions', () => {
  const room = { opensAt: new Date('2026-10-01'), closesAt: new Date('2026-10-02'), manuallyEndedAt: new Date('2026-10-02') };
  const now = Date.parse('2026-11-15');
  assert.equal(releasedRoom(room, false, now), true);
  assert.equal(releasedRoom(room, true, now), false, 'even manual closure cannot expose a pending attempt through AI');
  assert.equal(releasedRoom({ ...room, closesAt: new Date('2026-12-01') }, false, now), false);
  assert.equal(releasedRoom({ ...room, opensAt: new Date('2026-12-01') }, false, now), false);
});

test('personal reads bind both tenant and student, use a snapshot and write only the AI cache', async () => {
  const calls = [], writes = [];
  const connection = {
    startSession: async () => ({ withTransaction: async (run, options) => { assert.equal(options.readConcern.level, 'snapshot'); await run(); }, endSession: async () => {} }),
    db: { collection: name => ({
      find(filter, options) {
        calls.push({ name, filter, options });
        if (['selfassessments', 'testattempts', 'practiceanswers'].includes(name)) {
          assert.equal(String(filter.studentId), account.userId);
          assert.equal(String(filter.tuitionId), account.tuitionId);
        }
        const cursor = { sort() { return cursor; }, limit(n) { assert(n <= 1001); return cursor; }, toArray: async () => [] };
        return cursor;
      },
      aggregate(pipeline) {
        assert.equal(String(pipeline[0].$match.tuitionId), account.tuitionId);
        assert.deepEqual(pipeline[0].$match.$or, [{ submittedAt: null }, { suspendedAt: { $ne: null } }]);
        return { toArray: async () => [] };
      },
      findOne: async filter => { assert.equal(String(filter.tuitionId), account.tuitionId); assert.equal(filter.studentId, account.userId); return null; },
      updateOne: async (filter, update) => { writes.push(name); assert.equal(filter.synthetic, false); assert(filter.userId instanceof Types.ObjectId); assert.equal(update.$set.data.student.studentId, account.userId); },
    }) },
  };
  const profile = await personalProfile(connection, account);
  assert.equal(profile.summary.classification, 'not studied');
  assert.deepEqual(writes, ['ai_learning_profiles']);
  assert(calls.every(c => c.options.session));
});

test('textbook metadata preserves parent identities without inventing prose, edition or weightage', () => {
  const book = textbookMetadata({ _id: 'book', standard: '11th', subject: 'Physics', chapters: [
    { chapterNumber: 1, code: 'a', name: 'Motion', marks: 5, pdfPath: 'local/a.pdf', topics: [{ topicNumber: '1.1', name: 'Introduction' }] },
    { chapterNumber: 1, code: 'b', name: 'Forces', topics: [{ topicNumber: '1.1', name: 'Introduction' }] },
  ] });
  assert.equal(book.contentAvailability, 'metadata-only');
  assert.equal(book.edition, undefined); assert.equal(book.chapters[0].marks, undefined);
  assert.notEqual(book.chapters[0].topics[0].id, book.chapters[1].topics[0].id);
  assert.equal(selectChapter(book, '1').length, 2);
  assert.equal(selectChapter(book, 'a').length, 1);
  assert.equal(searchMetadata([book], 'introduction').length, 2);
  assert.equal(searchMetadata([book], '.*').length, 0, 'search treats input literally');
});
