// Read-only live verification. Run from papers with tsx; --generate makes ONE
// on-demand request to the existing configured Ollama model. No student queries.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const { connectDB } = await import('../src/lib/db');
const { retrieveTextbookContext, validateTextbookText, selectTextbookPassages } = await import('../src/lib/ai-learning/textbook-context');
const { explain } = await import('../src/lib/ai-learning/explain');
const mongoose = await connectDB();
try {
  const db = mongoose.connection.db!;
  if (db.databaseName !== 'pcmb') throw Error('Unexpected database');
  const rows = await db.collection('textbooks').aggregate([
    { $unwind: '$chapters' }, { $unwind: '$chapters.topics' },
    { $project: { _id: 0, standard: 1, subject: 1, chapter: '$chapters.name', chapterNumber: '$chapters.chapterNumber', topic: '$chapters.topics.name', topicNumber: '$chapters.topics.topicNumber',
      content: { $substrCP: [{ $ifNull: ['$chapters.topics.content', ''] }, 0, 24001] }, text: { $cond: [{ $eq: [{ $trim: { input: { $ifNull: ['$chapters.topics.content', ''] } } }, ''] }, { $substrCP: [{ $ifNull: ['$chapters.topics.text', ''] }, 0, 24001] }, ''] } } },
    { $limit: 2000 },
  ], { maxTimeMS: 15000 }).toArray();
  const flags: Record<string, number> = {};
  let reliable = 0;
  const findings = rows.map(r => {
    const text = r.content?.trim() ? r.content : r.text;
    const quality = validateTextbookText(text, r.topic, String(r.topicNumber));
    const passages = quality.reliable ? selectTextbookPassages(text, r.topic) : '';
    const selected = validateTextbookText(passages, r.topic, '');
    const accepted = quality.reliable && selected.reliable;
    if (accepted) reliable++;
    for (const flag of quality.flags) flags[flag] = (flags[flag] || 0) + 1;
    return { standard: r.standard, subject: r.subject, chapter: r.chapter, topic: r.topic, topicNumber: r.topicNumber, accepted, flags: quality.flags, selectedChars: passages.length };
  });
  const request = { exam: 'JEE', standard: '12', subject: 'Chemistry', chapter: { number: 1 }, topic: { number: '1.1' } };
  const context = await retrieveTextbookContext(request, db);
  const namedContext = await retrieveTextbookContext({ ...request, chapter: 'Solutions', topic: 'Types of Solutions' }, db);
  if (context.fingerprint !== namedContext.fingerprint) throw Error('Number/name mismatch');
  let nernstRejected = false;
  try { await retrieveTextbookContext({ ...request, chapter: { number: 2 }, topic: { number: '2.3' } }, db); } catch (e) { nernstRejected = (e as { status?: number }).status === 422; }
  if (!nernstRejected) throw Error('Nernst must fail closed');
  const evidence: Record<string, unknown> = { verifiedAt: new Date().toISOString(), database: db.databaseName, collection: 'textbooks', topicsAudited: rows.length, acceptedByHeuristics: reliable, rejectedByHeuristics: rows.length - reliable, flags,
    knownCases: findings.filter(r => r.standard === '12th' && r.subject === 'Chemistry' && ['1.1', '1.3', '1.4', '2.3'].includes(r.topicNumber)),
    source: context.source, selectedChars: context.selectedChars, sourceFingerprint: context.fingerprint, sourceExcerpt: context.passages.slice(0, 350), numberAndNameAgree: true, nernstRejected,
  };
  const save = () => writeFileSync('../reports/AI_TEXTBOOK_GROUNDING_VERIFICATION.json', JSON.stringify(evidence, null, 2) + '\n');
  save();
  if (process.argv.includes('--generate')) {
    const start = Date.now();
    let verifiedPayload = false;
    const observingFetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const marker = 'TEXTBOOK_DATA_JSON (quoted data):\n';
      const sent = JSON.parse(body.prompt.slice(body.prompt.indexOf(marker) + marker.length));
      if (sent !== context.passages || body.model !== 'qwen3.5:4b-q4_K_M') throw Error('Unexpected source/model');
      verifiedPayload = true;
      evidence.promptSha256 = createHash('sha256').update(body.prompt).digest('hex');
      try {
        const response = await fetch(url, init);
        evidence.ollamaHttpStatus = response.status;
        if (!response.ok) evidence.ollamaError = (await response.clone().text()).slice(0, 500);
        return response;
      } catch (error) { evidence.transportError = (error as Error).name; throw error; }
    }) as typeof fetch;
    try {
      const result = await explain('read-only-grounding-verification', { title: 'Types of Solutions', exam: 'JEE', standard: '12', subject: 'Chemistry', chapter: 'Solutions', topic: 'Types of Solutions', understanding: { name: 'Foundation' } }, 'simpler', context, observingFetch);
      Object.assign(evidence, { result });
    } catch (error) { evidence.generationError = (error as { status?: number }).status || (error as Error).name; process.exitCode = 1; }
    Object.assign(evidence, { model: process.env.AI_LEARNING_OLLAMA_MODEL, verifiedPayload, generationMs: Date.now() - start });
  }
  save();
  writeFileSync('../tmp/textbook-quality-findings.json', JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await mongoose.disconnect(); }
