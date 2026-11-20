// AI Learning only: ordinary practice and formal assessment policies are unchanged.
export function learningDifficulties(level?: string | null): string[] {
  if (level === 'Foundation') return ['Easy'];
  if (level === 'Advanced') return ['Hard'];
  if (level === 'Proficient') return ['Medium', 'Hard'];
  return ['Easy', 'Medium'];
}

// This bank has chapter/topic labels, but no question-level subtopic mapping.
// A distinct subtopic cannot safely fall back to every question of its parent.
export function exactLearningNode(area: { subject: string; standard: string; chapter: string; topic: string }, cell: string) {
  try {
    const parts = JSON.parse(cell);
    if (!Array.isArray(parts) || parts.length !== 6 || parts.some(x => typeof x !== 'string')) return null;
    const [, subject, standard, chapter, topic, subtopic] = parts;
    if (subject !== area.subject || standard !== area.standard || chapter !== area.chapter || topic !== area.topic || !topic.trim()) return null;
    if (subtopic.trim() && subtopic.trim().toLowerCase() !== topic.trim().toLowerCase()) return null;
    return { subject, standard: `${standard}th`, chapter, topic };
  } catch { return null; }
}

const string = (field: string) => ({ $convert: { input: `$${field}`, to: 'string', onError: '', onNull: '' } });
const text = (field: string) => ({ $gt: [{ $strLenCP: { $trim: { input: string(field) } } }, 0] });
const numericKey = { $convert: { input: '$correctAnswer', to: 'double', onError: null, onNull: null } };
const assets = (field: string) => ({ $gt: [{ $size: { $filter: { input: { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] }, as: 'url', cond: { $regexMatch: { input: { $convert: { input: '$$url', to: 'string', onError: '', onNull: '' } }, regex: '^(https?://|/)[^\\s]+$' } } } } }, 0] });

export function learningQualityFilter(level?: string | null): Record<string, unknown> {
  return {
    difficulty: { $in: learningDifficulties(level) },
    $expr: { $and: [
      text('questionText'),
      { $or: [
        { $and: [{ $eq: ['$answerType', 'MCQ'] }, { $in: ['$correctAnswer', ['A', 'B', 'C', 'D']] }, ...['A', 'B', 'C', 'D'].map(k => ({ $or: [text(`option${k}`), assets(`optionDiagramUrls.${k}`)] }))] },
        { $and: [{ $eq: ['$answerType', 'Numerical'] }, { $regexMatch: { input: string('correctAnswer'), regex: '^\\s*[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\s*$' } }, { $ne: [numericKey, null] }, { $lte: [{ $abs: numericKey }, Number.MAX_VALUE] }] },
      ] },
      { $or: [{ $not: [{ $regexMatch: { input: string('questionText'), regex: '(shown in (the )?(figure|diagram)|figure (below|above)|diagram (below|above))', options: 'i' } }] }, assets('diagramUrls')] },
    ] },
  };
}

export function validSandboxQuestion(q: Record<string, unknown>): boolean {
  if (typeof q.questionText !== 'string' || !q.questionText.trim() || typeof q.sourceId !== 'string') return false;
  if (q.answerType === 'Numerical') return typeof q.correctAnswer === 'string' && !!q.correctAnswer.trim() && Number.isFinite(Number(q.correctAnswer));
  return q.answerType === 'MCQ' && ['A', 'B', 'C', 'D'].includes(String(q.correctAnswer)) && ['A', 'B', 'C', 'D'].every(k => typeof q[`option${k}`] === 'string' && !!String(q[`option${k}`]).trim());
}
