import { requireUser } from '@/lib/auth';
import { controlAttempt } from '@/lib/attempt-control';
import { readJson, route } from '@/lib/http';
import { mustEdit, testFor } from '@/lib/tests';

export const dynamic = 'force-dynamic';
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const actor = await requireUser(req, 'teacher', 'tuition');
  const { test, canEdit } = await testFor(actor, params.id);
  mustEdit(canEdit);
  const attempt = await controlAttempt(test, actor, await readJson(req));
  return { ok: true, attemptId: String(attempt._id) };
});
