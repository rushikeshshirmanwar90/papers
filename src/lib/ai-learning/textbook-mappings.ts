import type { TextbookRequest } from './textbook-context';

// Reviewed against pcmb.textbooks on 2026-11-15. These are source mappings,
// independent of assessment/mastery and official examination syllabus nodes.
// Internal unit "1" is NOT an NCERT chapter number (the stored chapter is 3).
const vectorFundamentals = {
  id: 'physics-11-vector-fundamentals-v1',
  chapter: 'Motion in a Plane',
  topic: 'Scalars and Vectors',
  // This extraction contains previous-section prose and a trailing contents list.
  start: /^3\.2\s+SCALARS AND VECTORS\s*$/im,
  end: /^3\.1\s+Introduction\s*$/im,
  concepts: [/\bscalars?\b/i, /\bvectors?\b/i, /\bdirection\b/i, /\bmagnitude\b/i],
};

export function resolveTextbookMapping(request: TextbookRequest) {
  if (!['jee', 'neet'].includes(request.exam.toLowerCase()) || !/^(11|11th)$/.test(request.standard) || request.subject !== 'Physics') return null;
  // An explicit NCERT selector must never be reinterpreted as an internal label.
  if (typeof request.chapter !== 'string' || typeof request.topic !== 'string') return null;
  if (!['1 Motion in a Plane: Vectors', 'Motion in a Plane: Vectors', 'Motion in a Plane'].includes(request.chapter) || request.topic !== 'Fundamentals of Vectors') return null;
  if (request.subtopic && request.subtopic !== request.topic) return null;
  return vectorFundamentals;
}

export function mappedVectorPassage(text: string) {
  const start = vectorFundamentals.start.exec(text);
  if (!start) return '';
  let passage = text.slice(start.index);
  const end = vectorFundamentals.end.exec(passage);
  if (end) passage = passage.slice(0, end.index);
  // Exclude the incomplete extraction tail, never invent or repair source text.
  const lastSentence = [...passage.matchAll(/[.!?](?=\s|$)/g)].at(-1)?.index;
  if (lastSentence === undefined) return '';
  passage = passage.slice(0, lastSentence + 1).trim();
  return vectorFundamentals.concepts.every(pattern => pattern.test(passage)) ? passage : '';
}
