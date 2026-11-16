import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { calculate, identity } from './intelligence.mjs';
import { realStudent, assessmentCopy, practiceCopy, releasedRoom } from './evidence.mjs';
import { examOf, subjectsFor } from './companion.mjs';

const LIMIT = 200, PRACTICE_LIMIT = 1000, CACHE_MS = 5 * 60_000;
export const digest = value => createHash('sha256').update(JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item)).digest('hex');
const fields = { questions: 1, answers: 1, submittedAt: 1, score: 1, maxScore: 1, correctCount: 1, wrongCount: 1, skippedCount: 1, timeTakenSeconds: 1 };

export async function syntheticStudents(db) {
  return { students: (await db.collection('ai_learning_profiles').find({ synthetic: true, tuitionId: null }, { projection: { student: 1 } }).sort({ studentId: 1 }).limit(10).toArray()).map(r => r.student) };
}
export async function syntheticProfile(db, studentId) {
  const row = await db.collection('ai_learning_profiles').findOne({ studentId, synthetic: true, tuitionId: null }, { projection: { data: 1 } });
  return row?.data ?? null;
}

// Read one consistent snapshot, including the release boundary, before using
// any cached teacher evidence. No test lifecycle helper is called: those write.
export async function personalProfile(connection, account) {
  const student = realStudent(account), db = connection.db;
  const scope = { studentId: student.studentId, userId: new Types.ObjectId(account.userId), tuitionId: new Types.ObjectId(account.tuitionId), synthetic: false, examVersion: student.examVersion, standard: student.standard };
  const sourceScope = { studentId: scope.userId, tuitionId: scope.tuitionId };
  const session = await connection.startSession();
  let result, evidenceHash, refreshed = false;
  try {
    await session.withTransaction(async () => {
      const opts = { session, maxTimeMS: 10000 };
      // Sequential operations are intentional: MongoDB transactions do not
      // support parallel operations on a shared session.
      const selfHeads = await db.collection('selfassessments').find({ ...sourceScope, submittedAt: { $type: 'date' } }, { ...opts, projection: { updatedAt: 1, submittedAt: 1 } }).sort({ createdAt: -1, _id: -1 }).limit(LIMIT + 1).toArray();
      const attemptHeads = await db.collection('testattempts').find({ ...sourceScope, submittedAt: { $type: 'date' }, suspendedAt: null }, { ...opts, projection: { testId: 1, submittedAt: 1, rev: 1 } }).sort({ _id: -1 }).limit(LIMIT + 1).toArray();
      const rooms = await db.collection('testrooms').find({ _id: { $in: attemptHeads.slice(0, LIMIT).map(a => a.testId) }, tuitionId: scope.tuitionId }, { ...opts, projection: { opensAt: 1, closesAt: 1, updatedAt: 1, controlRevision: 1 } }).limit(LIMIT).toArray();
      const blocked = new Set((await db.collection('testattempts').aggregate([
        { $match: { tuitionId: scope.tuitionId, testId: { $in: rooms.map(t => t._id) }, $or: [{ submittedAt: null }, { suspendedAt: { $ne: null } }] } },
        { $group: { _id: '$testId' } }, { $limit: LIMIT },
      ], opts).toArray()).map(a => String(a._id)));
      const released = rooms.filter(t => releasedRoom(t, blocked.has(String(t._id))));
      const releasedIds = new Set(released.map(t => String(t._id)));
      const safeAttempts = attemptHeads.slice(0, LIMIT).filter(a => releasedIds.has(String(a.testId)));
      const practice = await db.collection('practiceanswers').find(sourceScope, { ...opts, projection: { questionId: 1, answeredAt: 1, selected: 1, correct: 1, subject: 1, standard: 1, chapter: 1, topic: 1 } }).sort({ _id: -1 }).limit(PRACTICE_LIMIT + 1).toArray();
      evidenceHash = digest({ adapter: 'companion-v4', student, selfHeads, safeAttempts, released, practice });
      const cached = await db.collection('ai_learning_profiles').findOne({ ...scope, evidenceHash, generatedAt: { $gt: new Date(Date.now() - CACHE_MS) } }, { ...opts, projection: { data: 1 } });
      if (cached?.data) { result = cached.data; return; }
      refreshed = true;
      const selfs = await db.collection('selfassessments').find({ ...sourceScope, _id: { $in: selfHeads.slice(0, LIMIT).map(a => a._id) } }, { ...opts, projection: fields }).limit(LIMIT).toArray();
      const attempts = await db.collection('testattempts').find({ ...sourceScope, _id: { $in: safeAttempts.map(a => a._id) } }, { ...opts, projection: { ...fields, testId: 1 } }).limit(LIMIT).toArray();
      const fullRooms = await db.collection('testrooms').find({ tuitionId: scope.tuitionId, _id: { $in: released.map(t => t._id) } }, { ...opts, projection: { questions: 1 } }).limit(LIMIT).toArray();
      const roomById = new Map(fullRooms.map(t => [String(t._id), t]));
      const assessments = [
        ...selfs.map(a => assessmentCopy(a, a.questions || [], student, 'self')),
        ...attempts.map(a => assessmentCopy(a, roomById.get(String(a.testId))?.questions || [], student, 'teacher')),
      ];
      const truncated = selfHeads.length > LIMIT || attemptHeads.length > LIMIT;
      // When older snapshots were omitted, practice could mirror one of them.
      // Conservatively omit practice in that case instead of double counting.
      const practices = truncated ? [] : practice.slice(0, PRACTICE_LIMIT);
      const questions = await db.collection('questions').find({ _id: { $in: practices.map(p => p.questionId) } }, { ...opts, projection: { questionText: 1, answerType: 1 } }).limit(PRACTICE_LIMIT).toArray();
      const questionById = new Map(questions.map(q => [String(q._id), q]));
      const practiceRows = practices.filter(p => questionById.has(String(p.questionId))).map(p => practiceCopy(p, questionById.get(String(p.questionId)), student)).filter(q => subjectsFor(examOf(student)).includes(q.subject));
      const cells = [...assessments.flatMap(a => a.questions), ...practiceRows].filter(q => q.standard === student.standard && q.examVersion === student.examVersion);
      const mappings = [...new Map(cells.map(q => [identity(q), { ...q, confidence: 0, reviewStatus: 'unmapped', data: {} }])).values()];
      result = calculate(student, assessments, mappings, Date.now(), practiceRows);
      // Keep earlier-class revision evidence separate from current-class mastery.
      // Reuse the same calculator and release checks; never infer a prerequisite
      // relationship merely because a topic belongs to Class 11.
      const foundation = student.standard === '12'
        ? calculate({ ...student, standard: '11' }, assessments, [], Date.now(), practiceRows)
        : null;
      result.foundationAreas = foundation?.subtopics || [];
      result.foundationMistakes = (foundation?.mistakes || []).map(m => ({ ...m, attempts: m.attempts.slice(-20), repeatedQuestions: m.repeatedQuestions.slice(0, 50) }));
      result.history = result.history.filter(h => h.asked > 0);
      result.mistakes = result.mistakes.map(m => ({ ...m, attempts: m.attempts.slice(-20), repeatedQuestions: m.repeatedQuestions.slice(0, 50), detailsLimited: m.attempts.length > 20 || m.repeatedQuestions.length > 50 }));
      result.coverage.scope = 'observed question-bank taxonomy; official syllabus mapping not certified';
      result.evidence = { selfAssessments: selfs.length, releasedTeacherAttempts: attempts.length, excludedTeacherAttempts: attemptHeads.length - safeAttempts.length, practiceRecords: practiceRows.length,
        truncated: truncated || practice.length > PRACTICE_LIMIT, assessmentLimitPerKind: LIMIT, practiceLimit: PRACTICE_LIMIT,
        examVersionNote: 'Historical records do not store an official examination syllabus version. Unversioned evidence is kept separate.',
        missingSubtopicNote: 'Absent subtopics remain empty; they are not inferred from topic names.' };
    }, { readConcern: { level: 'snapshot' } });
  } finally { await session.endSession(); }
  // Only the AI cache is written. The next request revalidates release metadata
  // even if a concurrent refresh publishes an older cache entry.
  if (refreshed) await db.collection('ai_learning_profiles').updateOne(scope, { $set: { student, data: result, evidenceHash, generatedAt: new Date() } }, { upsert: true });
  return result;
}
