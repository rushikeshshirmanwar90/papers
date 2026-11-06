import { reconcileVisibilityLocked } from "@/lib/attempt-visibility";
import type { TestAttemptDoc } from "@/models/TestAttempt";
import TestAttempt from '@/models/TestAttempt';
import type { TestRoomDoc } from '@/models/TestRoom';
import type { ClientSession } from 'mongoose';
import { withTestLock } from '@/lib/test-lock';
import { finalizeLocked } from '@/lib/attempts';

/** Only individual continuations can outlive normal closing. Before closing a
 * suspension awaits the teacher; after closing it is finalized once no active
 * extended attempt remains (see completionReleased). */
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
  // The room lock is also used by extension/suspension. An in-flight extension
  // cannot commit after a reader has decided to release the answer key.
  return withTestLock(test as Pick<TestRoomDoc, '_id'>, async (fresh, session) => {
    if (fresh.opensAt.getTime() > Date.now() || fresh.closesAt?.getTime() > Date.now()) return false;
    if (!fresh.manuallyEndedAt) {
      const watching = await TestAttempt.find({ testId: fresh._id, tuitionId: fresh.tuitionId, submittedAt: null, suspendedAt: null, visibility: { $ne: null } }).session(session) as TestAttemptDoc[];
      for (const attempt of watching) await reconcileVisibilityLocked(fresh, attempt, session);
    }
    if (fresh.manuallyEndedAt) return true;
    // Final completion point: no active extended attempt remains, so unresolved
    // suspensions are submitted with their saved answers (idempotent under the lock).
    if (await continuationOf(fresh._id, new Date(), session, false)) return false;
    const suspended = await TestAttempt.find({ testId: fresh._id, tuitionId: fresh.tuitionId, submittedAt: null, suspendedAt: { $ne: null } }).session(session) as TestAttemptDoc[];
    for (const attempt of suspended) await finalizeLocked(fresh, attempt, session, new Date(), true);
    return true;
  });
}

/** Batch result/analysis callers use this too, so a peer's pending attempt
 * cannot leak answers or marks through another endpoint. */
export async function releasedOnly<T extends { _id: unknown; manuallyEndedAt?: Date | null }>(tests: T[]) {
  const decisions = await Promise.all(tests.map(completionReleased));
  return tests.filter((_, i) => decisions[i]);
}
