import { requireUser } from '@/lib/auth';
import { HttpError, isObjectId, readJson, route } from '@/lib/http';
import { mustEdit, testFor } from '@/lib/tests';
import { hasManagedAccess, accessOf, activated, audienceBatches, batchesOfTest } from '@/lib/test-access';
import TestRoom from '@/models/TestRoom';
import TestAttempt from '@/models/TestAttempt';
import User from '@/models/User';
export const dynamic = 'force-dynamic';
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req);
  const body = await readJson(req);
  const action = String(body.action);
  for (let retry = 0; retry < 8; retry++) {
    const { test, canEdit } = await testFor(session, params.id);
    if (!hasManagedAccess(test)) throw new HttpError(400, 'This test uses legacy access.');
    if (test.closesAt.getTime() <= Date.now()) throw new HttpError(400, 'This test has ended.');
    const studentId = session.role === 'student' ? session.userId : body.studentId;
    if (!isObjectId(studentId)) throw new HttpError(400, 'Choose a student.');
    const student = await User.findOne({ _id: studentId, tuitionId: session.tuitionId, role: 'student' });
    if (!student) throw new HttpError(404, 'Student not found.');
    const roster = (test.roster ?? []).map(r => ({ studentId: r.studentId, allowed: r.allowed, started: r.started, request: r.request, decidedBy: r.decidedBy, decidedAt: r.decidedAt }));
    let row = roster.find(r => String(r.studentId) === String(studentId));
    if (session.role === 'student') {
      const access = await accessOf(test, session);
      if (action !== 'request' || !access.canRequest) throw new HttpError(403, 'You cannot request access to this test.');
      if (row?.request === 'pending') return { ok: true };
    } else {
      mustEdit(canEdit);
      await audienceBatches(session, batchesOfTest(test).map(String), test.subject);
      if (!['approve', 'decline', 'grant', 'revoke'].includes(action)) throw new HttpError(400, 'Choose a valid action.');
      if ((action === 'approve' || action === 'decline') && row?.request !== 'pending') throw new HttpError(409, 'This request is no longer pending.');
    }
    if (action !== 'decline' && action !== 'revoke' && (!activated(student) || !batchesOfTest(test).some(id => String(id) === String(student.batchId)))) throw new HttpError(400, 'Student must be activated and enrolled in a selected batch.');
    if (action === 'revoke' && (row?.started || await TestAttempt.exists({ testId: test._id, studentId }))) throw new HttpError(409, 'An attempt has already started. Access cannot be revoked.');
    if (action === 'grant' && row?.allowed) return { ok: true };
    if (!row) {
      row = { studentId: student._id, allowed: false, started: false, request: null, decidedBy: undefined, decidedAt: undefined };
      roster.push(row);
    }
    if (action === 'request') row.request = 'pending';
    else {
      row.allowed = action === 'approve' || action === 'grant';
      row.request = action === 'decline' ? 'declined' : row.allowed ? 'approved' : null;
      row.decidedBy = session.user._id as typeof row.studentId;
      row.decidedAt = new Date();
    }
    const changed = await TestRoom.updateOne({ _id: test._id, tuitionId: session.tuitionId, __v: test.get('__v'), closesAt: { $gt: new Date() } }, { $set: { roster }, $inc: { __v: 1 } });
    if (changed.matchedCount) return { ok: true };
  }
  throw new HttpError(409, 'Access changed while saving. Refresh and try again.');
});
