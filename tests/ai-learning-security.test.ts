import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

// This test never connects. Rejected requests must fail before database access.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:1/pcmb';
test('demo sessions are explicitly local, scoped and disabled in production', async () => {
  const { learningRequest } = await import('../src/lib/ai-learning/handler');
  const saved = { ...process.env };
  const env = process.env as Record<string, string | undefined>;
  const request = (path: string, method = 'GET', headers: Record<string, string> = {}, host = '127.0.0.1') => new NextRequest(`http://${host}:3001/api/ai-learning/${path}`, { method, headers });
  try {
    env.NODE_ENV = 'production'; env.AI_LEARNING_DEMO_ENABLED = 'true'; env.AI_LEARNING_LOCAL_BOUND = 'true';
    assert.equal((await learningRequest(request('demo/session', 'POST', { 'x-ai-learning-local': '1' }), ['demo', 'session'])).status, 404);
    assert.equal((await learningRequest(request('students'), ['students'])).status, 404);
    env.NODE_ENV = 'development'; env.AI_LEARNING_LOCAL_BOUND = 'false';
    assert.equal((await learningRequest(request('students'), ['students'])).status, 404);
    env.AI_LEARNING_LOCAL_BOUND = 'true';
    assert.equal((await learningRequest(request('students'), ['students'])).status, 401);
    assert.equal((await learningRequest(request('demo/session', 'POST'), ['demo', 'session'])).status, 403);
    assert.equal((await learningRequest(request('demo/session', 'POST', { 'x-ai-learning-local': '1' }, 'example.org'), ['demo', 'session'])).status, 403);
    assert.equal((await learningRequest(request('demo/session', 'POST', { 'x-ai-learning-local': '1', origin: 'https://example.org' }), ['demo', 'session'])).status, 403);
    assert.equal((await learningRequest(request('demo/session', 'POST', { 'x-ai-learning-local': '1', 'x-forwarded-for': '192.168.1.1' }), ['demo', 'session'])).status, 403);
    const response = await learningRequest(request('demo/session', 'POST', { 'x-ai-learning-local': '1' }), ['demo', 'session']);
    assert.equal(response.status, 200);
    const session = await response.json();
    assert(session.token.length >= 32); assert(session.expiresAt > Date.now());
    assert.equal((await learningRequest(request('me/profile'), ['me', 'profile'])).status, 401);
    assert.equal((await learningRequest(request('me/foreign/profile'), ['me', 'foreign', 'profile'])).status, 404);
  } finally {
    for (const key of ['NODE_ENV', 'AI_LEARNING_DEMO_ENABLED', 'AI_LEARNING_LOCAL_BOUND']) if (saved[key] === undefined) delete env[key]; else env[key] = saved[key];
    delete global._aiDemoSession;
  }
});
