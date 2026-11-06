import type { ClientSession } from 'mongoose';
import { HttpError } from '@/lib/http';
import TestRoom, { type TestRoomDoc } from '@/models/TestRoom';

/** All attempt mutations and completion decisions serialize on their room.
 * Transactions retry conflicts with saves, extensions, resume and hard stop. */
export async function withTestLock<T>(test: Pick<TestRoomDoc, '_id'> & Partial<Pick<TestRoomDoc, 'tuitionId'>>, run: (fresh: TestRoomDoc, session: ClientSession) => Promise<T>): Promise<T> {
  return TestRoom.db.transaction(async session => {
    const fresh = await TestRoom.findOneAndUpdate(
      { _id: test._id, ...(test.tuitionId ? { tuitionId: test.tuitionId } : {}) },
      { $inc: { controlRevision: 1 } }, { returnDocument: 'after', session },
    ) as TestRoomDoc | null;
    if (!fresh) throw new HttpError(404, 'Test not found.');
    return run(fresh, session);
  });
}
