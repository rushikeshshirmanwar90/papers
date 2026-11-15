import { handle } from '../../../../../../ai-lab/api.mjs';
import { getStore } from '../../../../../../ai-lab/store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { path } = await context.params;
  return handle(request, path, getStore);
}
