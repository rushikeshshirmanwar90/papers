import type { Session } from '@/lib/auth';
import { HttpError, isObjectId } from '@/lib/http';
import { batchFor, mustTeach } from '@/lib/teaching';
import { programOf, questionBankOf, type SchoolSubject } from '@/lib/school';
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
    const batch = await batchFor(session, id);
    mustTeach(session, batch, subject as SchoolSubject);
    if (!questionBankOf(programOf(batch))) throw new HttpError(400, 'A selected batch has no question bank.');
    return batch;
  }));
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

