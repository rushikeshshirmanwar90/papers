import { reconcileVisibilityLocked } from "@/lib/attempt-visibility";
import type { TestAttemptDoc } from "@/models/TestAttempt";
import TestAttempt from '@/models/TestAttempt';
import type { TestRoomDoc } from '@/models/TestRoom';
import type { ClientSession } from 'mongoose';
import { withTestLock } from '@/lib/test-lock';
import { deadlineOf, finalizeLocked } from '@/lib/attempts';
import { testEngagements } from '@/lib/engagement/rules';

/** Extensions and suspensions awaiting a teacher both keep the room live. */
export async function continuationOf(testId: unknown, now = new Date(), session?: ClientSession, includeSuspended = true) {
  return !!await TestAttempt.exists({ testId, submittedAt: null, ...(includeSuspended
    ? { $or: [{ suspendedAt: { $ne: null } }, { individualDeadline: { $gt: now } }] }
    : { suspendedAt: null, individualDeadline: { $gt: now } }) }).session(session ?? null);
}

export async function hydrateCompletion(test: TestRoomDoc) {
  test.pendingResolution = !test.manuallyEndedAt && (test.closesAt?.getTime() <= Date.now()
    ? !await completionReleased(test) : await continuationOf(test._id));
  return test;
}

export async function completionReleased(test: { _id: unknown }) {
  let finished: TestAttemptDoc[] = [];
  // The room lock is also used by extension/suspension. An in-flight extension
  // cannot commit after a reader has decided to release the answer key.
  const released = await withTestLock(test as Pick<TestRoomDoc, '_id'>, async (fresh, session) => {
    finished = []; // the lock may retry this callback
    if (fresh.opensAt.getTime() > Date.now() || fresh.closesAt?.getTime() > Date.now()) return false;
    if (!fresh.manuallyEndedAt) {
      const watching = await TestAttempt.find({ testId: fresh._id, tuitionId: fresh.tuitionId, submittedAt: null, suspendedAt: null, visibility: { $ne: null } }).session(session) as TestAttemptDoc[];
      for (const attempt of watching) await reconcileVisibilityLocked(fresh, attempt, session);
    }
    if (fresh.manuallyEndedAt) return true;
    const unfinished = await TestAttempt.find({ testId: fresh._id, tuitionId: fresh.tuitionId, submittedAt: null }).session(session) as TestAttemptDoc[];
    const now = new Date();
    let pending = false;
    for (const attempt of unfinished) {
      if (attempt.suspendedAt || deadlineOf(fresh, attempt) > now) pending = true;
      else finished.push(await finalizeLocked(fresh, attempt, session, now));
    }
    if (pending) return false;
    return true;
  });
  // Participation XP for attempts this finished, after the lock (idempotent, never throws).
  if (finished.length) await testEngagements(finished.filter(a => a.submittedAt));
  return released;
}

/** Batch result/analysis callers use this too, so a peer's pending attempt
 * cannot leak answers or marks through another endpoint. */
export async function releasedOnly<T extends { _id: unknown; manuallyEndedAt?: Date | null }>(tests: T[]) {
  const decisions = await Promise.all(tests.map(completionReleased));
  return tests.filter((_, i) => decisions[i]);
}
