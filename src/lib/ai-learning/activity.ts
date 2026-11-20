import { HttpError } from '@/lib/http';
import type { mongo } from 'mongoose';
import { nodeFilter, pyqGroups } from '@/lib/practice';
import { MIN_QUESTIONS } from '@/lib/self-assessment';
import { type QuestionBank, type SchoolStandard, type SchoolSubject } from '@/lib/school';
import { identity } from './intelligence.mjs';
import { buildCompanion, examOf, subjectsFor } from './companion.mjs';
import { exactLearningNode, learningDifficulties, learningQualityFilter, validSandboxQuestion } from './practice-policy';

// Starting-point check: which exam subjects have enough existing bank questions at
// the student's class to build a Quick Assessment. Uses the same bank counts as
// Practice; it never creates or scores anything. Demo students have no bank access.
export async function diagnosticReadiness(profile: Parameters<typeof buildCompanion>[0]) {
  const exam = examOf(profile.student) as QuestionBank | null;
  if (profile.student.synthetic || !exam) return { mode: profile.student.synthetic ? 'demo' : 'personal', subjects: [] };
  const standard = `${profile.student.standard}th`;
  const subjects = await Promise.all(subjectsFor(exam).map(async (subject: string) => {
    const groups = await pyqGroups(exam, subject as SchoolSubject);
    const questions = groups.filter(g => g.standard === standard).reduce((n, g) => n + g.questions, 0);
    return { subject, ready: questions >= MIN_QUESTIONS };
  }));
  return { mode: 'personal', subjects };
}

// Deliberately lazy: bank availability and demo question bodies are never loaded
// to render the recommendation on the home screen.
export async function learningActivity(db: mongo.Db | undefined, profile: Parameters<typeof buildCompanion>[0], key: string | null) {
  if (!db) throw new HttpError(503, 'Study activities are temporarily unavailable.');
  const companion = buildCompanion(profile);
  const area = companion.areas.find((a: { key: string }) => a.key === key);
  if (!area) throw new HttpError(404, 'Choose a topic from your current study plan.');
  if (profile.student.synthetic) {
    const records = await db.collection('ai_learning_history').find({ synthetic: true, tuitionId: null, studentId: profile.student.studentId }, { projection: { data: 1 }, maxTimeMS: 10000 }).sort({ submittedAt: -1 }).limit(6).toArray();
    const questions = new Map();
    for (const record of records) for (const q of record.data?.questions || []) {
      if (questions.size >= 5) break;
      if (identity(q) !== area.key || questions.has(q.sourceId) || !validSandboxQuestion(q) || !learningDifficulties(area.understanding?.name).includes(q.difficulty)) continue;
      const { questionText, optionA = '', optionB = '', optionC = '', optionD = '', answerType, correctAnswer, explanation, diagramUrls, optionDiagramUrls } = q;
      questions.set(q.sourceId, { id: q.sourceId, questionText, optionA, optionB, optionC, optionD, answerType, correctAnswer, explanation, diagramUrls, optionDiagramUrls });
      if (questions.size === 5) break;
    }
    return { area, mode: 'demo', available: questions.size > 0, questions: [...questions.values()].slice(0, 5),
      note: 'Saved synthetic questions for an interactive sandbox. This is not the verified exam question bank. Checking answers never changes learning history.' };
  }
  const exam = examOf(profile.student) as QuestionBank | null;
  const standard = `${area.standard}th` as SchoolStandard;
  const exact = exactLearningNode(area, area.key);
  const place = exact ? { subject: area.subject as SchoolSubject, standard, chapter: exact.chapter, topic: exact.topic } : null;
  const base = exam && place ? await nodeFilter(exam, place) : null;
  const filter = base ? { ...base, ...learningQualityFilter(area.understanding?.name) } : null;
  const count = filter ? await db.collection('questions').countDocuments(filter, { limit: MIN_QUESTIONS, maxTimeMS: 10000 }) : 0;
  const available = count > 0;
  return { area, mode: 'personal', available, assessmentAvailable: count >= MIN_QUESTIONS, place: available ? place : null,
    // No synonym or textbook name is silently substituted for a bank topic.
    note: available ? 'Complete questions from your exam bank, matched to this chapter, topic and understanding level.' : 'No complete questions with a verified topic match at your current difficulty are available. Review the topic, or choose another topic in Self Assessment.' };
}
