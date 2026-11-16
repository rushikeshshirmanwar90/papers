import type { NextRequest } from 'next/server';
import { learningRequest, withDemoCors } from '@/lib/ai-learning/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: { path: string[] } };
async function handle(req: NextRequest, { params }: Context) {
  return withDemoCors(req, await learningRequest(req, params.path));
}
export const GET = handle;
export const POST = handle;
export function OPTIONS(req: NextRequest) {
  return withDemoCors(req, new Response(null, { status: 204 }));
}
