import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { HttpError } from '@/lib/http';
import TestRoom, { type TestRoomDoc } from '@/models/TestRoom';

type LockTarget = Pick<TestRoomDoc, '_id'> & Partial<Pick<TestRoomDoc, 'tuitionId'>>;
type LockedRun<T> = (fresh: TestRoomDoc, session: ClientSession) => Promise<T>;

/** All attempt mutations and completion decisions serialize on their room.
 * Transactions retry conflicts with saves, extensions, resume and hard stop.
 * A standalone server (self-hosted, no replica set) has no transactions, so
 * there the room is held by a short lease instead: still one at a time, but
 * a failed run is not rolled back. */
export async function withTestLock<T>(test: LockTarget, run: LockedRun<T>): Promise<T> {
  if (await supportsTransactions()) {
    return TestRoom.db.transaction(session => claim(test, run, session));
  }
  return withLease(test, run);
}

async function claim<T>(test: LockTarget, run: LockedRun<T>, session: ClientSession): Promise<T> {
  const fresh = await TestRoom.findOneAndUpdate(
    { _id: test._id, ...(test.tuitionId ? { tuitionId: test.tuitionId } : {}) },
    { $inc: { controlRevision: 1 } }, { returnDocument: 'after', session },
  ) as TestRoomDoc | null;
  if (!fresh) throw new HttpError(404, 'Test not found.');
  return run(fresh, session);
}

// Asked once per process: replica set members and mongos support transactions.
let transactions: Promise<boolean> | undefined;
function supportsTransactions(): Promise<boolean> {
  transactions ??= TestRoom.db.asPromise()
    .then(conn => conn.db!.admin().command({ hello: 1 }))
    .then(hello => Boolean(hello.setName) || hello.msg === 'isdbgrid')
    .catch(error => { transactions = undefined; throw error; });
  return transactions;
}

const LEASE_MS = 30_000; // a crashed holder frees the room after this
const WAIT_MS = 10_000;  // give up waiting for a busy room after this

async function withLease<T>(test: LockTarget, run: LockedRun<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  // The native collection is used so the lease fields bypass the schema.
  for (;;) {
    const now = new Date();
    const taken = await TestRoom.collection.updateOne(
      { _id: test._id, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS), lockToken: token } },
    );
    if (taken.matchedCount === 1) break;
    if (!(await TestRoom.exists({ _id: test._id }))) throw new HttpError(404, 'Test not found.');
    if (Date.now() > deadline) throw new HttpError(503, 'This test is busy. Please try again.');
    await new Promise(resolve => setTimeout(resolve, 25 + Math.random() * 50));
  }

  const session = await TestRoom.db.startSession();
  try {
    return await claim(test, run, session);
  } finally {
    await session.endSession();
    await TestRoom.collection.updateOne({ _id: test._id, lockToken: token }, { $unset: { lockedUntil: '', lockToken: '' } });
  }
}
