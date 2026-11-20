import { createHash } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { HttpError } from '@/lib/http';
import { resolveTextbookMapping, mappedVectorPassage } from './textbook-mappings';

type Selector = string | { id?: string; number?: string | number; name?: string; slug?: string };
export type TextbookRequest = { exam: string; standard: string; subject: string; chapter: Selector; topic: Selector; subtopic?: string };
export type TextbookSource = { standard: string; subject: string; chapter: string; chapterNumber: string; topic: string; topicNumber: string; subtopic?: string; field: 'content' | 'text' };
export type TextbookContext = { passages: string; fingerprint: string; source: TextbookSource; quality: { flags: string[] }; selectedChars: number };
export const SOURCE_UNAVAILABLE = 'Reliable textbook material is not available for this topic yet. Please use your class notes or ask your teacher.';
const unavailable = () => new HttpError(422, SOURCE_UNAVAILABLE);
const normal = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const corrupt = /[\uE000-\uF8FF\uFFFD]|(?:[=+×÷]\s*){4,}/;
const MAX_SOURCE = 24000, MAX_PASSAGE = 6000;

// Explicit IDs/numbers are authoritative. Names are a chapter-scoped fallback,
// never a fuzzy/global search. Regex is escaped and anchored.
function selectorMatch(path: string, selector: Selector, numberField: string): Document {
  const s = typeof selector === 'string' ? { name: selector } : selector;
  if (s.id) return { $expr: { $eq: [{ $toString: `$${path}._id` }, s.id] } };
  const number = s.number ?? (/^\d+(?:\.\d+)*$/.test(s.name || '') ? s.name : undefined);
  if (number !== undefined) return { [`${path}.${numberField}`]: { $in: [String(number), ...(numberField === 'chapterNumber' ? [Number(number)] : [])] } };
  if (s.slug) return { [`${path}.slug`]: s.slug };
  if (!s.name?.trim() || s.name.length > 250) throw unavailable();
  const pattern = '^' + s.name.trim().split(/[\s-]+/).map(escape).join('[\\s-]+') + '$';
  return { $or: [{ [`${path}.name`]: { $regex: pattern, $options: 'i' } }, { [`${path}.slug`]: { $regex: pattern, $options: 'i' } }] };
}

export function textbookPipeline(request: TextbookRequest): Document[] {
  const mapping = resolveTextbookMapping(request);
  if (mapping) request = { ...request, chapter: mapping.chapter, topic: mapping.topic, subtopic: undefined };
  const standard = /^(11|12)(?:th)?$/.exec(request.standard)?.[1];
  const exam = request.exam.toLowerCase();
  if (!standard || !['jee', 'neet'].includes(exam) || !['Physics', 'Chemistry', 'Mathematics', 'Biology'].includes(request.subject)) throw unavailable();
  const chapter = selectorMatch('chapters', request.chapter, 'chapterNumber');
  const topic = selectorMatch('chapters.topics', request.topic, 'topicNumber');
  return [
    { $match: { standard: `${standard}th`, subject: request.subject, exams: exam } },
    { $unwind: '$chapters' }, { $match: chapter },
    { $unwind: '$chapters.topics' }, { $match: topic },
    // A third match is enough to prove ambiguity; no entire book crosses the DB boundary.
    { $limit: 3 },
    { $project: { _id: 0, standard: 1, subject: 1, chapter: '$chapters.name', chapterNumber: '$chapters.chapterNumber',
      topic: '$chapters.topics.name', topicNumber: '$chapters.topics.topicNumber',
      content: { $substrCP: [{ $ifNull: ['$chapters.topics.content', ''] }, 0, MAX_SOURCE + 1] },
      text: { $cond: [{ $eq: [{ $trim: { input: { $ifNull: ['$chapters.topics.content', ''] } } }, ''] }, { $substrCP: [{ $ifNull: ['$chapters.topics.text', ''] }, 0, MAX_SOURCE + 1] }, ''] },
      // Only verified subtopic entries may narrow the parent section.
      subtopics: { $map: { input: { $slice: [{ $filter: { input: { $ifNull: ['$chapters.topics.subtopics', []] }, as: 's', cond: { $and: [{ $eq: ['$$s.reviewStatus', 'verified'] }, { $eq: ['$$s.name', request.subtopic || ''] }] } } }, 3] }, as: 's', in: { name: '$$s.name', reviewStatus: '$$s.reviewStatus',
        content: { $substrCP: [{ $ifNull: ['$$s.content', ''] }, 0, MAX_SOURCE + 1] },
        text: { $cond: [{ $eq: [{ $trim: { input: { $ifNull: ['$$s.content', ''] } } }, ''] }, { $substrCP: [{ $ifNull: ['$$s.text', ''] }, 0, MAX_SOURCE + 1] }, ''] },
      } } },
    } },
  ];
}

export function validateTextbookText(text: string, topic: string, number: string) {
  const flags: string[] = [];
  if (!text.trim()) return { reliable: false, flags: ['empty-text'] };
  // Ignore the assigned heading when checking relevance: the heading itself
  // cannot establish that the extraction underneath belongs to this section.
  const lines = text.trim().split('\n');
  const titleWords = normal(topic).split(' ').filter(w => w.length > 3 && !['with', 'from', 'types', 'introduction'].includes(w));
  let start = 0;
  while (start < Math.min(4, lines.length) && (normal(topic).includes(normal(lines[start])) || /^\s*\d+(?:\.\d+)+\s/.test(lines[start]) && start === 0)) start++;
  const body = lines.slice(start).join('\n');
  if (text.trim().length < 180 || body.split(/\s+/).length < 35) flags.push('short-snippet');
  if (/^(?:\d+(?:\.\d+)*\s+)?(?:calculate|consult|find|determine|how much|what is|show that|prove|suggest)\b/i.test(body.trim()) || /\b(?:intext questions|exercises?)\b/i.test(body) && !/\b(?:is defined|are defined|refers to|means that|is called)\b/i.test(body)) flags.push('exercise-only');
  const relevant = titleWords.filter(w => normal(body).includes(w));
  if (!titleWords.length || relevant.length < Math.max(1, Math.ceil(titleWords.length / 2))) flags.push('unrelated-content');
  const heading = /^\s*(\d+(?:\.\d+)+)\s+/.exec(text);
  if (heading && number && heading[1] !== number) flags.push('section-mismatch');
  if (heading && !normal(lines.slice(0, 4).join(' ')).includes(normal(topic))) flags.push('heading-mismatch');
  if (corrupt.test(text)) flags.push('broken-math-extraction');
  if (/ignore (?:all |previous |the )?instructions|system prompt|<\/?(?:system|assistant)>/i.test(text)) flags.push('source-instructions');
  return { reliable: !flags.some(f => f !== 'broken-math-extraction'), flags };
}

// Keep contiguous complete prose. Never splice a formula/derivation into a new
// order or truncate inside it. Corrupt equation tails are excluded, not repaired.
export function selectTextbookPassages(text: string, topic: string) {
  const paragraphs = text.split(/\n\s*\n/);
  const words = normal(topic).split(' ').filter(w => w.length > 3);
  const ranked = paragraphs.map((text, index) => ({ text, index, score: words.filter(w => normal(text).includes(w)).length })).sort((a,b) => b.score - a.score || a.index - b.index);
  const chosen: { text: string; index: number }[] = [];
  let size = 0;
  for (const block of ranked) {
    let safe = block.text;
    const badLine = safe.split('\n').findIndex(line => corrupt.test(line));
    if (badLine >= 0) safe = safe.split('\n').slice(0, Math.max(0, badLine - 1)).join('\n');
    if (safe.length > MAX_PASSAGE - size) {
      // Only a complete prose prefix is safe to shorten. A derivation that does
      // not fit is omitted entirely rather than cutting a multi-line equation.
      const prefix = safe.slice(0, MAX_PASSAGE - size);
      const end = [...prefix.matchAll(/[.!?](?=\s|$)/g)].at(-1)?.index;
      safe = end !== undefined && !/[=\\∑∫]/.test(prefix) ? prefix.slice(0, end + 1) : '';
    }
    if (safe.trim()) { chosen.push({ text: safe.trim(), index: block.index }); size += safe.length + 2; }
  }
  return chosen.sort((a,b) => a.index - b.index).map(b => b.text).join('\n\n');
}

export async function retrieveTextbookContext(request: TextbookRequest, database?: Db): Promise<TextbookContext> {
  const db = database || (await import('@/lib/db').then(m => m.connectDB())).connection.db;
  if (!db || db.databaseName !== 'pcmb') throw unavailable();
  const rows = await db.collection('textbooks').aggregate(textbookPipeline(request), { maxTimeMS: 5000 }).toArray();
  if (rows.length !== 1) throw unavailable(); // duplicate books/chapters/topics must be reviewed
  const row = rows[0];
  const mapping = resolveTextbookMapping(request);
  // Validate against the verified NCERT section, never the differing internal
  // heading. A distinct unreviewed child still requires its own verified entry.
  const subtopic = mapping ? undefined : request.subtopic;
  let field: 'content' | 'text' = row.content?.trim() ? 'content' : 'text';
  let text = String(row[field] || '');
  if (mapping) {
    if (row.chapter !== mapping.chapter || row.topic !== mapping.topic) throw unavailable();
    text = mappedVectorPassage(text);
  }
  const parentQuality = validateTextbookText(text, row.topic, String(row.topicNumber));
  if (!parentQuality.reliable) throw unavailable();
  if (subtopic && normal(subtopic) !== normal(row.topic)) {
    if (row.subtopics?.length !== 1 || row.subtopics[0].reviewStatus !== 'verified' || row.subtopics[0].name !== subtopic) throw unavailable();
    const child = row.subtopics[0];
    field = child.content?.trim() ? 'content' : 'text';
    text = String(child[field] || '');
  }
  const selectedTopic = subtopic || row.topic;
  const quality = validateTextbookText(text, selectedTopic, subtopic ? '' : String(row.topicNumber));
  if (!quality.reliable) throw unavailable();
  const passages = selectTextbookPassages(text, selectedTopic);
  if (!validateTextbookText(passages, selectedTopic, '').reliable || corrupt.test(passages)) throw unavailable();
  const source: TextbookSource = { standard: row.standard, subject: row.subject, chapter: row.chapter, chapterNumber: String(row.chapterNumber), topic: row.topic, topicNumber: String(row.topicNumber), ...(request.subtopic ? { subtopic: request.subtopic } : {}), field };
  return { passages, source, quality, selectedChars: passages.length, fingerprint: createHash('sha256').update(JSON.stringify([source, passages])).digest('hex') };
}
