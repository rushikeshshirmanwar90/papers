import { requireUser } from '@/lib/auth';
import { readJson, route } from '@/lib/http';
import { audienceBatches, readTestSubjects, rosterStudents, sharedScope } from '@/lib/test-access';
export const dynamic = 'force-dynamic';
export const POST = route(async req => {
  const session = await requireUser(req, 'teacher', 'tuition');
  const body = await readJson(req);
  const subjects = readTestSubjects(body);
  const batches = await audienceBatches(session, body.batchIds, subjects[0]);
  for (const subject of subjects) {
    await audienceBatches(session, body.batchIds, subject);
    sharedScope(batches, subject);
  }
  const students = await rosterStudents(session.tuitionId, batches.map(b => b._id));
  return { students: students.map(s => ({ id: String(s._id), name: s.name })) };
});
