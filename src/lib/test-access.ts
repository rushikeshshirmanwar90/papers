import type { Session } from '@/lib/auth';
import { HttpError, isObjectId } from '@/lib/http';
import { batchForTest } from '@/lib/teaching';
import { programOf, questionBankOf, type SchoolSubject } from '@/lib/school';
import type { BatchDoc } from '@/models/Batch';
import { verifyQuestions, type BankScope } from '@/lib/makePdfBank';
import TestRoom, { type TestRoomDoc } from '@/models/TestRoom';
import TestAttempt from '@/models/TestAttempt';
import User, { type UserDoc } from '@/models/User';

export const batchesOfTest = (test: Pick<TestRoomDoc, 'batchId' | 'batchIds'>) => test.batchIds?.length ? test.batchIds : [test.batchId];
// Explicit audience metadata must never fall back to enrollment-only permissions.
export const hasManagedAccess = (test: Pick<TestRoomDoc, 'accessVersion' | 'audienceMode' | 'roster'>) => test.accessVersion === 1 || test.audienceMode === 'selected' || Array.isArray(test.roster);
export const activated = (u: Pick<UserDoc, 'active' | 'accountStatus' | 'mustChangePassword'>) => u.active !== false && u.accountStatus !== 'invited' && !u.mustChangePassword;
export async function audienceBatches(session: Session, raw: unknown, subject: string) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50 || raw.some(id => !isObjectId(id))) throw new HttpError(400, 'Select valid batches.');
  return Promise.all([...new Set(raw as string[])].map(async id => {
    const batch = await batchForTest(session, id);
    if (!batch.subjects.includes(subject as SchoolSubject)) throw new HttpError(400, `${subject} isn't one of ${batch.name}'s subjects.`);
    if (!questionBankOf(programOf(batch))) throw new HttpError(400, 'A selected batch has no question bank.');
    return batch;
  }));
}
/**
 * The question-bank scope the selected batches share (exam and class), or a 400 when they don't fit together.
 * A batch with no class of its own takes the request's `standard`, as before; the class may stay '' for a custom test.
 */
export function sharedScope(batches: BatchDoc[], subject: string, fallbackStandard = ''): BankScope {
  const banks = new Set(batches.map(b => questionBankOf(programOf(b))));
  const standards = new Set(batches.map(b => b.standard).filter(Boolean));
  if (banks.size !== 1 || standards.size > 1) throw new HttpError(400, 'These batches have different exams or classes, so they cannot share one test. Pick batches of the same exam and class.');
  const exam = [...banks][0];
  if (!exam) throw new HttpError(400, 'Every selected batch needs a question bank.');
  return { course: 'Competitive', standard: [...standards][0] ?? fallbackStandard, exam, subject, source: 'regular', chapters: [], topics: [], years: [] };
}
/** Questions that name a bank question (a sourceId) must belong to the scope; none is stored from another exam, class or subject. */
export async function mustBeBankQuestions(scope: BankScope, questions: { sourceId?: unknown }[]) {
  const ids = questions.map(q => (q.sourceId ? String(q.sourceId) : '')).filter(Boolean);
  if (!ids.length) return;
  // A batch without a class of its own accepts either class's questions.
  const found = new Set<string>();
  for (const standard of scope.standard ? [scope.standard] : ['11th', '12th']) {
    for (const q of (await verifyQuestions({ ...scope, standard }, ids)).questions) found.add(String(q._id));
  }
  const dropped = new Set(ids).size - found.size;
  if (dropped > 0) throw new HttpError(400, `${dropped} selected question${dropped === 1 ? '' : 's'} do not belong to these batches' exam, class and subject.`);
}
export async function rosterStudents(tuitionId: unknown, batchIds: unknown[]) {
  return User.find({ tuitionId, role: 'student', batchId: { $in: batchIds }, active: true, accountStatus: { $ne: 'invited' }, mustChangePassword: { $ne: true } }).select('name batchId active accountStatus mustChangePassword');
}
export async function accessOf(test: TestRoomDoc, session: Session) {
  const attempt = await TestAttempt.exists({ testId: test._id, tuitionId: session.tuitionId, studentId: session.user._id });
  const inBatch = batchesOfTest(test).some(id => String(id) === String(session.user.batchId));
  const row = test.roster?.find(r => String(r.studentId) === session.userId);
  const allowed = !!attempt || (activated(session.user) && (hasManagedAccess(test) ? !!row?.allowed && inBatch : inBatch));
  return { visible: !!attempt || inBatch, allowed, request: row?.request ?? null, canRequest: hasManagedAccess(test) && inBatch && activated(session.user) && !allowed && test.closesAt.getTime() > Date.now() };
}
export async function requireTestAccess(test: TestRoomDoc, session: Session) {
  if (!(await accessOf(test, session)).allowed) throw new HttpError(403, 'Approval Required');
}
// A roster claim and revocation serialize on the same document. Once claimed,
// access cannot be revoked even if attempt creation is still in flight.
export async function claimStart(test: TestRoomDoc, session: Session) {
  if (!hasManagedAccess(test)) return;
  const claimed = await TestRoom.updateOne({ _id: test._id, tuitionId: session.tuitionId, opensAt: { $lte: new Date() }, closesAt: { $gt: new Date() }, roster: { $elemMatch: { studentId: session.user._id, allowed: true } } }, { $set: { 'roster.$.started': true }, $inc: { __v: 1 } });
  if (!claimed.matchedCount) throw new HttpError(403, 'Approval Required');
}

