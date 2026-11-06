import { requireUser } from '@/lib/auth';
import { attemptOut, currentAttempt, questionsFor, resultsReleased } from '@/lib/attempts';
import { route } from '@/lib/http';
import { testFor } from '@/lib/tests';
import { requireTestAccess } from '@/lib/test-access';

export const dynamic = 'force-dynamic';
/** No question payload, scoring analytics, or client-controlled resumption. */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireUser(req, 'student');
  const { test } = await testFor(actor, params.id);
  await requireTestAccess(test, actor);
  const attempt = await currentAttempt(test, actor);
  return {
    attempt: await attemptOut(test, attempt),
    // Running polls stay small. A terminal response carries the same guarded
    // review questions as submit, so auto-expiry can open the existing review.
    ...(attempt?.submittedAt ? { questions: questionsFor(test, await resultsReleased(test)) } : {}),
  };
});
