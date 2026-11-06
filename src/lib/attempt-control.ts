import { reconcileVisibilityLocked } from "@/lib/attempt-visibility";
import type { Session } from '@/lib/auth';
import { HttpError } from '@/lib/http';
import { deadlineOf, finalizeLocked } from '@/lib/attempts';
import { mustEdit } from '@/lib/tests';
import type { TestRoomDoc } from '@/models/TestRoom';
import { withTestLock } from '@/lib/test-lock';
import TestAttempt, { type TestAttemptDoc } from '@/models/TestAttempt';

export const MAX_EXTENSION_MINUTES = 120;
export function extensionMinutes(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_EXTENSION_MINUTES)
    throw new HttpError(400, `Additional minutes must be a whole number from 1 to ${MAX_EXTENSION_MINUTES}.`);
  return value;
}

export async function controlAttempt(test: TestRoomDoc, actor: Session, body: Record<string, unknown>) {
  mustEdit(actor.role === 'tuition' || (actor.role === 'teacher' && String(test.teacherId) === actor.userId));
  if (String(test.tuitionId) !== String(actor.tuitionId)) throw new HttpError(403, 'Not authorized.');
  const { action, studentId, requestId } = body;
  if (!['extend', 'resume', 'finalize'].includes(String(action)) || typeof studentId !== 'string' || !/^[a-f\d]{24}$/i.test(studentId)) throw new HttpError(400, 'Invalid attempt action.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new HttpError(400, 'A valid request ID is required.');
  const minutes = action === 'extend' ? extensionMinutes(body.minutes) : 0;
  const result = await withTestLock(test, async (fresh, session) => {
    let attempt = await TestAttempt.findOne({ testId: fresh._id, tuitionId: actor.tuitionId, studentId }).session(session) as TestAttemptDoc | null;
    if (!attempt) throw new HttpError(404, 'Attempt not found.');
    attempt = await reconcileVisibilityLocked(fresh, attempt, session);
    const previous = attempt.controls?.find(c => c.requestId === requestId);
    if (previous) {
      if (previous.action !== action || previous.minutes !== minutes || String(previous.teacherId) !== actor.userId) throw new HttpError(409, 'Request ID was already used.');
      return attempt;
    }
    if (fresh.manuallyEndedAt || attempt.submittedAt) return new HttpError(409, 'This attempt has ended.');
    const now = new Date();
    const oldDeadline = deadlineOf(fresh, attempt);
    if (action === 'extend' && (attempt.suspendedAt || oldDeadline <= now)) return new HttpError(409, 'Only an active, unexpired attempt can be extended.');
    if (action !== 'extend' && (!attempt.suspendedAt || !(attempt.remainingMs! > 0))) return new HttpError(409, 'Only a violation-suspended attempt can be resolved.');
    // A resume confirmation is tied to the suspension the teacher inspected.
    if (action !== 'extend' && body.suspendedAt !== attempt.suspendedAt?.toISOString()) return new HttpError(409, 'The suspension changed. Refresh before deciding.');
    const newDeadline = action === 'extend' ? new Date(oldDeadline.getTime() + minutes * 60_000)
      : action === 'resume' ? new Date(now.getTime() + attempt.remainingMs!) : oldDeadline;
    const changed = await TestAttempt.findOneAndUpdate({ _id: attempt._id, tuitionId: actor.tuitionId, submittedAt: null, rev: (attempt.rev ?? 0) === 0 ? { $in: [0, null] } : attempt.rev, ...(action === 'extend' ? { $expr: { $lt: ["$$NOW", oldDeadline] } } : {}) }, {
      $set: action === 'extend' ? { individualDeadline: newDeadline } : action === 'resume' ? { individualDeadline: newDeadline, suspendedAt: null, remainingMs: 0, endedReason: null, visibility: attempt.visibility ? { clientId: `resume_${requestId}`, sequence: 0, lastSeenAt: now, retiredClients: [...attempt.visibility.retiredClients, attempt.visibility.clientId] } : null } : {},
      $inc: { rev: 1, ...(action === 'resume' ? { resumeVersion: 1 } : {}) },
      $push: { controls: { requestId, action, teacherId: actor.user._id, at: now, minutes, oldDeadline, newDeadline } },
    }, { returnDocument: 'after', session }) as TestAttemptDoc | null;
    if (!changed) throw new HttpError(409, 'Attempt changed. Refresh and try again.');
    return action === 'finalize' ? finalizeLocked(fresh, changed, session, now, true) : changed;
  });
  if (result instanceof HttpError) throw result;
  return result;
}

export async function endTest(test: TestRoomDoc) {
  return withTestLock(test, async (fresh, session) => {
    if (fresh.manuallyEndedAt) return fresh;
    fresh.manuallyEndedAt = new Date();
    fresh.closesAt = fresh.manuallyEndedAt;
    await fresh.save({ session });
    const attempts = await TestAttempt.find({ testId: fresh._id, tuitionId: fresh.tuitionId, submittedAt: null }).session(session) as TestAttemptDoc[];
    for (const attempt of attempts) await finalizeLocked(fresh, attempt, session, fresh.manuallyEndedAt, true);
    return fresh;
  });
}
