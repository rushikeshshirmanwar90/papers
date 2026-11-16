import { scoreAnswers } from '../marking.ts';

export const ALGORITHM = 'phase2b-v2';
const DAY = 86400000;
const pct = (n, d) => d ? Math.round(n / d * 1000) / 10 : null;
export const identity = q => JSON.stringify([q.examVersion, q.subject, q.standard, q.chapter, q.topic, q.subtopic]);
export const topicIdentity = q => JSON.stringify([q.examVersion, q.subject, q.standard, q.chapter, q.topic]);
export function evidenceFor(studentId, assessments, practice = []) {
  const rows = [], represented = new Set();
  const seen = new Set();
  for (const a of assessments.filter(a => a.studentId === studentId && a.status === 'submitted').sort((a,b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (seen.has(a.assessmentId)) continue;
    seen.add(a.assessmentId);
    const saved = new Map(a.answers.map(x => [x.index, x]));
    const score = a.persistedAnswers
      ? { answers: a.questions.map((q, index) => saved.get(index) ?? { index, selected: null, correct: null }) }
      : scoreAnswers(a.questions, new Map(a.answers.map(x => [x.index, x.selected])), a.marksPerQuestion ?? 4, a.negativeMarks ?? 1);
    a.questions.forEach((q, i) => {
      represented.add(q.sourceId);
      if (!q.correctAnswer?.trim() || q.correctAnswer.toLowerCase() === 'bonus') return;
      rows.push({ ...q, ...score.answers[i], studentId, assessmentId: a.assessmentId, at: a.submittedAt });
    });
  }
  // PracticeAnswer is latest state, not an event log. Conservatively suppress any
  // source question already present in submitted assessment snapshots.
  const latest = new Map();
  for (const p of practice.filter(p => p.studentId === studentId && !represented.has(p.sourceId))) {
    const old = latest.get(p.sourceId);
    if (!old || p.at > old.at) latest.set(p.sourceId, p);
  }
  for (const p of latest.values()) {
    const result = p.hasPersistedCorrect ? { answers: [{ selected: p.selected, correct: p.correct }] }
      : scoreAnswers([p], new Map([[0, p.selected]]), 4, 1);
    if (p.hasPersistedCorrect || (p.correctAnswer?.trim() && p.correctAnswer.toLowerCase() !== 'bonus')) rows.push({ ...p, ...result.answers[0], assessmentId: p.assessmentId ?? `practice:${p.sourceId}` });
  }
  return rows.sort((a,b) => a.at.localeCompare(b.at));
}
export function summarize(rows, asOf) {
  const answered = rows.filter(r => r.selected !== null && r.correct !== null);
  const correct = answered.filter(r => r.correct).length;
  const questions = new Set(answered.map(r => r.sourceId)).size;
  const sessions = new Set(answered.map(r => r.assessmentId)).size;
  const accuracy = pct(correct, answered.length);
  const sufficient = answered.length >= 10 && questions >= 5 && sessions >= 2;
  const recent = answered.filter(r => asOf - Date.parse(r.at) <= 14 * DAY);
  const early = answered.filter(r => asOf - Date.parse(r.at) > 14 * DAY);
  const recentAccuracy = pct(recent.filter(r => r.correct).length, recent.length);
  const earlyAccuracy = pct(early.filter(r => r.correct).length, early.length);
  const delta = recent.length >= 5 && early.length >= 5 && new Set(recent.map(r=>r.assessmentId)).size >= 2 && new Set(early.map(r=>r.assessmentId)).size >= 2 ? Math.round((recentAccuracy - earlyAccuracy)*10)/10 : null;
  const last = rows.at(-1)?.at ?? null;
  // Additive: "Medium" is the bank default and cannot be told apart from unset,
  // so only an explicit "Hard" label counts as difficulty evidence.
  const hard = answered.filter(r => r.difficulty === 'Hard');
  return { hardAttempted: hard.length, hardCorrect: hard.filter(r => r.correct).length, asked: rows.length, attempted: answered.length, skipped: rows.length - answered.length, correct, wrong: answered.length - correct, accuracy,
    mastery: answered.length ? pct(correct, rows.length) : null, distinctQuestions: questions, assessmentCount: sessions,
    classification: !answered.length && !rows.length ? 'not studied' : !sufficient ? 'needs diagnosis' : accuracy >= 70 ? 'strong' : accuracy < 40 ? 'weak' : 'developing',
    confidence: Math.min(1, answered.length / 30, questions / 10, sessions / 3), recentAccuracy, recentAttempted: recent.length, historicalAccuracy: earlyAccuracy, improvement: delta,
    trend: delta === null ? 'insufficient data' : delta >= 15 ? 'improving' : delta <= -15 ? 'declining' : 'stable',
    lastEvidenceAt: last, daysSinceEvidence: last ? Math.max(0, Math.floor((asOf - Date.parse(last)) / DAY)) : null };
}
export function calculate(student, assessments, mappings, asOf = Date.now(), practice = []) {
  const relevant = mappings.filter(m => m.examVersion === student.examVersion && m.standard === student.standard);
  const rows = evidenceFor(student.studentId, assessments, practice).filter(r => r.examVersion === student.examVersion && r.standard === student.standard && Date.parse(r.at) <= asOf);
  // Include mapped cells with no evidence without interpreting absence as failure.
  const catalog = [...new Map([...relevant, ...rows].map(m => [identity(m), m])).values()];
  const dimensions = ['examVersion','subject','standard','chapter','topic','subtopic'];
  const subtopics = catalog.map(m => ({ key: identity(m), ...Object.fromEntries(dimensions.map(k => [k,m[k]])), ...summarize(rows.filter(r => identity(r) === identity(m)), asOf) }));
  const rollup = (key, dims) => [...new Map(catalog.map(m => [key(m),m])).values()].map(m => ({ key:key(m), ...Object.fromEntries(dims.map(k => [k,m[k]])), ...summarize(rows.filter(r => key(r) === key(m)),asOf) }));
  const topics = rollup(topicIdentity,dimensions.slice(0,5));
  const subjects = rollup(r => JSON.stringify([r.examVersion,r.subject,r.standard]),dimensions.slice(0,3));
  const mistakes = subtopics.map(area => {
    const errors = rows.filter(r => identity(r) === area.key && r.correct === false);
    const counts = new Map();
    for (const r of errors) counts.set(r.sourceId, (counts.get(r.sourceId) ?? 0) + 1);
    return { key: area.key, subject:area.subject, topic:area.topic, subtopic:area.subtopic, attempts:errors.map(r=>({sourceId:r.sourceId, at:r.at, questionText:r.questionText, selected:r.selected})), incorrect: errors.length, repeatedQuestions: [...counts].filter(([, n]) => n >= 2).map(([sourceId, count]) => ({ sourceId, count })), category: 'incorrect answer; misconception not diagnosed' };
  }).filter(m => m.incorrect);
  const recommendations = relevant.map(mapping => {
    const key = identity(mapping), stats = subtopics.find(t => t.key === key) ?? summarize([], asOf);
    const availableQuestions = null; // No independent bank inventory exists in this lab.
    const bankAvailability = 'unknown';
    const repeated = mistakes.find(m=>m.key===key)?.repeatedQuestions.length ?? 0;
    const urgency = stats.daysSinceEvidence === null ? 0 : Math.min(100, stats.daysSinceEvidence / 21 * 100);
    const severity = stats.mastery === null ? 0 : 100 - stats.mastery;
    const recentWeakness = stats.recentAccuracy === null ? 0 : 100-stats.recentAccuracy;
    const prerequisiteImportance = mapping.data?.prerequisiteImportance ?? 0;
    // Editorial prerequisite heuristic; no official examination weightage.
    const score = stats.attempted === 0 ? 0 : Math.round((severity * .35 + recentWeakness * .2 + urgency * .15 + prerequisiteImportance * 10 + Math.min(10, repeated * 3)) * (.3 + .7 * stats.confidence));
    const reason = `${stats.accuracy === null ? 'No attempted-answer evidence' : `${stats.accuracy}% accuracy (${stats.attempted} attempted, ${stats.skipped} skipped)`}; ${repeated} repeatedly missed questions; recent accuracy ${stats.recentAccuracy ?? 'unavailable'}; ${stats.classification}; mapping ${mapping.reviewStatus}.`;
    return { key, examVersion: mapping.examVersion, subject: mapping.subject, standard: mapping.standard, chapter: mapping.chapter, topic: mapping.topic, subtopic: mapping.subtopic, score, priority: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', reason, accuracy:stats.accuracy, classification:stats.classification, availableQuestions, bankAvailability, confidence: stats.confidence, revisionUrgency: Math.round(urgency), action: stats.classification === 'not studied' ? 'start learning, then take a diagnostic' : stats.classification === 'needs diagnosis' ? 'collect diagnostic evidence' : stats.classification === 'strong' ? 'spaced revision' : 'revise and practise', mappingConfidence: mapping.confidence, reviewStatus: mapping.reviewStatus, prerequisiteImportance };
  }).sort((a,b)=>b.score-a.score || a.key.localeCompare(b.key));
  const history = [...new Map(assessments.filter(a=>a.studentId===student.studentId && a.status==='submitted' && Date.parse(a.submittedAt)<=asOf && a.questions.every(q=>q.examVersion===student.examVersion)).map(a=>[a.assessmentId,a])).values()].map(a=>({ assessmentId:a.assessmentId, at:a.submittedAt, ...summarize(rows.filter(r=>r.assessmentId===a.assessmentId), asOf), result:a.result })).sort((a,b)=>a.at.localeCompare(b.at));
  return { student, algorithm: ALGORITHM, asOf: new Date(asOf).toISOString(), summary: summarize(rows, asOf), subjects, topics, subtopics,
    notStudiedAreas: subtopics.filter(t=>t.classification==='not studied'), needsDiagnosisAreas:subtopics.filter(t=>t.classification==='needs diagnosis'), weakAreas: subtopics.filter(t=>t.classification==='weak'), strongAreas: subtopics.filter(t=>t.classification==='strong'), history, mistakes, recommendations,
    revisionRecommendations: recommendations.filter(r=>r.classification!=='not studied' && (r.revisionUrgency>=33 || r.score>=25)),
    coverage: { scope:'editorial synthetic mapping set, not complete official syllabus', total: relevant.length, encountered: relevant.filter(m=>subtopics.some(t=>t.key===identity(m) && t.asked>0)).length, sufficientEvidence: relevant.filter(m=>subtopics.some(t=>t.key===identity(m) && ['strong','developing','weak'].includes(t.classification))).length } };
}
