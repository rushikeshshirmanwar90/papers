import test from 'node:test';
import assert from 'node:assert/strict';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused'; // module-load check only; nothing connects
const { buildPrompt: groundedPrompt, explain: groundedExplain, cleanOutput, readExplainRequest, resetExplainLimits, EXPLAIN_NOTICE } = await import('../src/lib/ai-learning/explain');

const context = { passages: 'Dimensional analysis compares the dimensions of physical quantities to check consistent equations.', fingerprint: 'fixture-source-v1', source: { standard: '11th', subject: 'Physics', chapter: 'Units and Measurements', chapterNumber: '1', topic: 'Dimensional Analysis', topicNumber: '1.1', field: 'content' as const }, quality: { flags: [] }, selectedChars: 98 };
const buildPrompt = (area: Parameters<typeof groundedPrompt>[0], mode: Parameters<typeof groundedPrompt>[1]) => groundedPrompt(area, mode, context);
const explain = (student: string, area: Parameters<typeof groundedExplain>[1], mode: Parameters<typeof groundedExplain>[2], fetchImpl: typeof fetch) => groundedExplain(student, area, mode, context, fetchImpl);
const area = { title: 'Dimensional Analysis', subject: 'Physics', chapter: 'Units and Measurements', topic: 'Measurement foundations', understanding: { name: 'Foundation' } };
const ok = (response: unknown, seen: { body?: string; url?: string } = {}) => (async (url: URL | string, init?: RequestInit) => {
  seen.url = String(url); seen.body = String(init?.body);
  return new Response(JSON.stringify({ response }), { status: 200 });
}) as typeof fetch;
const env = (patch: Record<string, string | undefined>, run: () => Promise<void>) => async () => {
  const old = { ...process.env };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetExplainLimits();
  try { await run(); } finally { process.env = old; }
};

test('requests accept only the three modes and a topic', () => {
  assert.deepEqual(readExplainRequest({ cell: 'a', mode: 'example' }), { cell: 'a', mode: 'example' });
  for (const bad of [null, {}, { cell: 'a', mode: 'essay' }, { cell: '', mode: 'simpler' }]) assert.throws(() => readExplainRequest(bad), /Choose/);
});

test('the prompt uses topic names and level only, and forbids citations', () => {
  const prompt = buildPrompt(area, 'simpler');
  assert.match(prompt, /Dimensional Analysis/); assert.match(prompt, /Foundation/); assert.match(prompt, /Do not cite NCERT/);
  assert.doesNotMatch(buildPrompt({ ...area, understanding: null }, 'detailed'), /Foundation level/);
  assert.match(buildPrompt({ ...area, exam: 'NEET' }, 'simpler'), /Exam: NEET\. Subject: Physics/);
  // Only exam, subject, chapter, topic, level and mode: no identifiers, tokens or answers can appear.
  const sent = buildPrompt({ ...area, exam: 'JEE', key: 'secret-cell-key', studentId: 'synthetic-02', questionText: 'Q?' } as typeof area, 'example');
  assert.doesNotMatch(sent, /secret-cell-key|synthetic-02|Q\?/);
});

test('generation is off until an installed model is named', env({ AI_LEARNING_OLLAMA_MODEL: undefined }, async () => {
  await assert.rejects(explain('me:one', area, 'simpler', ok('text')), (e: { status?: number }) => e.status === 503);
}));

test('a generated answer carries the grounded AI notice and uses the configured local model', env({ AI_LEARNING_OLLAMA_MODEL: 'installed-model', AI_LEARNING_OLLAMA_URL: undefined }, async () => {
  const seen: { body?: string; url?: string } = {};
  const out = await explain('me:one', area, 'example', ok('  Step 1... ', seen));
  assert.equal(out.text, 'Step 1...'); assert.equal(out.notice, EXPLAIN_NOTICE);
  assert.equal(JSON.parse(seen.body!).model, 'installed-model'); assert.equal(JSON.parse(seen.body!).stream, false);
  assert.match(seen.url!, /^http:\/\/127\.0\.0\.1:11434\/api\/generate$/);
}));

test('non-loopback endpoints, empty output and model errors never return invented text', env({ AI_LEARNING_OLLAMA_MODEL: 'm' }, async () => {
  process.env.AI_LEARNING_OLLAMA_URL = 'http://example.com:11434';
  await assert.rejects(explain('me:a', area, 'simpler', ok('x')), (e: { status?: number }) => e.status === 503);
  delete process.env.AI_LEARNING_OLLAMA_URL;
  await assert.rejects(explain('me:b', area, 'simpler', ok('   ')), (e: { status?: number }) => e.status === 503);
  await assert.rejects(explain('me:c', area, 'simpler', (async () => { throw new Error('down'); }) as typeof fetch), (e: { status?: number }) => e.status === 503);
  await assert.rejects(explain('me:d', area, 'simpler', (async () => new Response('', { status: 500 })) as typeof fetch), (e: { status?: number }) => e.status === 503);
}));

test('requests are rate limited per student', env({ AI_LEARNING_OLLAMA_MODEL: 'm' }, async () => {
  const topic = (i: number) => ({ ...area, key: `cell-${i}`, title: `Topic ${i}` });
  for (let i = 0; i < 6; i++) await explain('me:busy', topic(i), 'simpler', ok('fine'));
  await assert.rejects(explain('me:busy', topic(99), 'simpler', ok('fine')), (e: { status?: number }) => e.status === 429);
  await explain('me:other', topic(99), 'simpler', ok('fine'));
  await explain('me:busy', topic(0), 'simpler', ok('never called')); // cached: no inference, not throttled
}));

test('thinking is disabled, never returned, and output is bounded per mode', env({ AI_LEARNING_OLLAMA_MODEL: 'm' }, async () => {
  const seen: { body?: string } = {};
  const fetchImpl = (async (_u: unknown, init?: RequestInit) => { seen.body = String(init?.body); return new Response(JSON.stringify({ response: 'Answer.', thinking: 'secret reasoning' })); }) as typeof fetch;
  const out = await explain('me:t', area, 'detailed', fetchImpl);
  assert.equal(JSON.parse(seen.body!).think, false);
  assert(JSON.parse(seen.body!).options.num_predict <= 400);
  assert(!JSON.stringify(out).includes('secret reasoning'));
}));

test('inline reasoning tags are removed and truncated output ends on a full sentence', () => {
  assert.equal(cleanOutput('<think>hidden</think>Visible text.', false), 'Visible text.');
  assert.equal(cleanOutput('<think>never closed', false), '');
  assert.equal(cleanOutput('One idea here. Another idea here. A third that was cut o', true), 'One idea here. Another idea here.');
});

test('identical requests are cached and concurrent ones share one generation', env({ AI_LEARNING_OLLAMA_MODEL: 'm' }, async () => {
  let calls = 0;
  const slow = (async () => { calls++; await new Promise(r => setTimeout(r, 20)); return new Response(JSON.stringify({ response: 'Once.' })); }) as typeof fetch;
  const [a, b] = await Promise.all([explain('me:x', area, 'example', slow), explain('me:y', area, 'example', slow)]);
  assert.equal(a.text, 'Once.'); assert.equal(b.text, 'Once.');
  await explain('me:x', area, 'example', slow);
  assert.equal(calls, 1);
  await explain('me:x', area, 'simpler', slow); // another mode is a different explanation
  assert.equal(calls, 2);
  await explain('me:x', { ...area, understanding: { name: 'Advanced' } }, 'simpler', slow); // another level too
  assert.equal(calls, 3);
}));

test('Markdown emphasis is removed while maths and numbering survive', () => {
  const out = cleanOutput('**Worked Example:**\n1.  **Identify**: use $F = m \\times a$.\n    *Reason: break it down.*\n* bullet', false);
  assert.equal(out, 'Worked Example:\n1. Identify: use $F = m \\times a$.\n    Reason: break it down.\n• bullet');
});

