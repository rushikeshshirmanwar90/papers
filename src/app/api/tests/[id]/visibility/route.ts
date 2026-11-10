import { requireUser } from '@/lib/auth';
import { reportVisibility } from '@/lib/attempt-visibility';
import { attemptOut, questionsFor, resultsReleased } from '@/lib/attempts';
import { testEngagement } from '@/lib/engagement/rules';
import { requireTestAccess } from '@/lib/test-access';
import { readJson, route } from '@/lib/http';
import { testFor } from '@/lib/tests';

export const dynamic = 'force-dynamic';
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireUser(req, 'student');
  const { test } = await testFor(actor, params.id);
  await requireTestAccess(test, actor);
  const attempt = await reportVisibility(test, actor.user._id, await readJson(req));
  // A report after the student's time ran out finishes the attempt: participation XP after the lock (idempotent, never throws).
  if (attempt.submittedAt) await testEngagement(attempt);
  return { attempt: await attemptOut(test, attempt), ...(attempt.submittedAt ? { questions: questionsFor(test, await resultsReleased(test)) } : {}) };
});
