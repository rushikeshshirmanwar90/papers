// Adapters read persisted results. They never submit, finalize, score or repair
// an application assessment. Missing historical syllabus versions stay unknown.
import { examOf, subjectsFor } from './companion.mjs';
export const normalizeStandard = value => ({ '11th': '11', '12th': '12' }[value] ?? value ?? '');
export function realStudent(session) {
  return {
    studentId: session.userId, synthetic: false,
    examVersion: `unversioned:${session.user.program || session.user.track || 'unknown'}`,
    standard: normalizeStandard(session.user.standard),
    scenario: 'Personal assessment evidence',
  };
}
export function releasedRoom(room, pending, now = Date.now()) {
  return !!room && Date.parse(room.opensAt) <= now && Date.parse(room.closesAt) <= now && !pending;
}
export function questionCopy(q, student, fallbackId) {
  return {
    sourceId: q.sourceId ? String(q.sourceId) : fallbackId,
    examVersion: q.examVersion || student.examVersion,
    subject: ['Botany', 'Zoology'].includes(q.subject) ? 'Biology' : q.subject || '', standard: normalizeStandard(q.standard),
    chapter: q.chapter || '', topic: q.topic || '', subtopic: q.subtopic || '',
    questionText: q.questionText || '', answerType: q.answerType || 'MCQ', correctAnswer: q.correctAnswer || '',
  };
}
export function assessmentCopy(row, questions, student, kind) {
  const assessmentId = `${kind}:${row._id}`;
  const allowed = subjectsFor(examOf(student));
  const scoped = questions.map((q, index) => ({ question: questionCopy(q, student, `${assessmentId}:${index}`), index })).filter(q => allowed.includes(q.question.subject));
  return {
    assessmentId, studentId: student.studentId, status: 'submitted',
    submittedAt: new Date(row.submittedAt).toISOString(), persistedAnswers: true,
    questions: scoped.map(q => q.question),
    answers: scoped.flatMap((q, index) => {
      const answer = (row.answers || []).find(a => a.index === q.index);
      return answer ? [{ ...answer, index }] : [];
    }),
    result: Object.fromEntries(['score', 'maxScore', 'correctCount', 'wrongCount', 'skippedCount', 'timeTakenSeconds'].map(k => [k, row[k] ?? 0])),
  };
}
export function practiceCopy(row, question, student) {
  return { ...questionCopy({ ...question, sourceId: row.questionId, subject: row.subject, standard: row.standard, chapter: row.chapter, topic: row.topic }, student, String(row.questionId)),
    studentId: student.studentId, at: new Date(row.answeredAt).toISOString(), selected: row.selected,
    correct: row.correct, hasPersistedCorrect: true,
    // Latest-state practice is not an independent assessment-session history.
    assessmentId: 'practice:latest-state',
  };
}
