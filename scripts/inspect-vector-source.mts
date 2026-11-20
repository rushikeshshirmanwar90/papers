// Read-only, bounded inspection of the original failing curriculum cell.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));
const { connectDB } = await import('../src/lib/db');
const { textbookPipeline, retrieveTextbookContext, validateTextbookText } = await import('../src/lib/ai-learning/textbook-context');
const m = await connectDB();
try {
  const db = m.connection.db!;
  if (db.databaseName !== 'pcmb') throw Error('Unexpected database');
  const request = { exam: 'JEE', standard: '11', subject: 'Physics', chapter: '1 Motion in a Plane: Vectors', topic: 'Fundamentals of Vectors' };
  const chapters = await db.collection('textbooks').aggregate([
    { $match: { standard: '11th', subject: 'Physics' } }, { $unwind: '$chapters' },
    { $match: { 'chapters.name': /Motion in a Plane|Vectors/i } },
    { $project: { _id: 0, standard: 1, subject: 1, exams: 1, chapter: '$chapters.name', number: '$chapters.chapterNumber', topics: { $map: { input: '$chapters.topics', as: 't', in: { name: '$$t.name', number: '$$t.topicNumber', contentChars: { $strLenCP: { $ifNull: ['$$t.content', ''] } }, textChars: { $strLenCP: { $ifNull: ['$$t.text', ''] } } } } } } },
  ], { maxTimeMS: 10000 }).toArray();
  const sections = await db.collection('textbooks').aggregate([
    { $match: { standard: '11th', subject: 'Physics' } }, { $unwind: '$chapters' }, { $unwind: '$chapters.topics' },
    { $match: { 'chapters.topics.name': /Vector/i } },
    { $project: { _id: 0, chapter: '$chapters.name', chapterNumber: '$chapters.chapterNumber', topic: '$chapters.topics.name', topicNumber: '$chapters.topics.topicNumber', content: { $substrCP: [{ $ifNull: ['$chapters.topics.content', ''] }, 0, 24001] }, text: { $substrCP: [{ $ifNull: ['$chapters.topics.text', ''] }, 0, 24001] } } }, { $limit: 30 },
  ], { maxTimeMS: 10000 }).toArray();
  const originalRows = await db.collection('textbooks').aggregate(textbookPipeline(request)).toArray();
  const legacyChapterCount = await db.collection('textbooks').countDocuments({ standard: '11th', subject: 'Physics', exams: 'jee', 'chapters.name': request.chapter });
  const reviewedMappings = await db.collection('ai_syllabus_mappings').find({ subject: 'Physics', standard: { $in: ['11', '11th'] }, reviewStatus: 'verified' }, { projection: { _id: 0, identity: 1, kind: 1, reviewStatus: 1 } }).limit(20).toArray();
  const evidence = { at: new Date().toISOString(), chapters, legacyChapterCount, resolvedMatchCount: originalRows.length, reviewedMappings, sections: sections.map(r => ({ ...r, quality: validateTextbookText(r.content || r.text, r.topic, String(r.topicNumber)) })) };
  writeFileSync('../tmp/vector-source-inspection.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ chapters, matchCount: originalRows.length, sections: sections.map(r => ({ chapter: r.chapter, topic: r.topic, chars: (r.content || r.text).length })) }, null, 2));
  const context = await retrieveTextbookContext(request, db);
  const verification: Record<string, unknown> = { at: evidence.at, database: db.databaseName, collection: 'textbooks', legacyChapterCount, resolvedMatchCount: originalRows.length, reviewedMappings, context };
  if (process.argv.includes('--generate')) {
    const { explain } = await import('../src/lib/ai-learning/explain');
    const start = Date.now();
    const observingFetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const marker = 'TEXTBOOK_DATA_JSON (quoted data):\n';
      const sent = JSON.parse(payload.prompt.slice(payload.prompt.indexOf(marker) + marker.length));
      if (sent !== context.passages || payload.model !== 'qwen3.5:4b-q4_K_M' || payload.think !== false) throw Error('Wrong evidence or model payload');
      verification.exactPassageSupplied = true;
      verification.model = payload.model;
      verification.thinkingDisabled = true;
      const res = await fetch(url, init);
      verification.ollamaStatus = res.status;
      return res;
    }) as typeof fetch;
    verification.result = await explain('vector-source-verification', { ...request, title: request.topic, understanding: null }, 'simpler', context, observingFetch);
    verification.generationMs = Date.now() - start;
  }
  writeFileSync('../reports/VECTOR_SOURCE_VERIFICATION.json', JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification));
} finally { await m.disconnect(); }

