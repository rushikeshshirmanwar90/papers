import { safeAward, engagementSnapshot, type AwardStudent, type EngagementField } from "@/lib/engagement/award";
import { ENGAGEMENT, difficultyOf } from "@/lib/engagement/config";
import { istDate } from "@/lib/engagement/time";
import PracticeAnswer from "@/models/PracticeAnswer";

// One hook per learning event. Each decides kind, key and XP and calls the
// engine through safeAward, so none of them can throw into answering,
// submitting or a test. Each returns the `engagement` field for the response
// (null when something failed).

const safely = async (work: () => Promise<EngagementField | null>) => {
  try {
    return await work();
  } catch (error) {
    console.error("[engagement] hook failed", error);
    return null;
  }
};

/** The student's previous answer to a practice question, read before it's overwritten. `undefined` if the read failed. */
export async function priorPractice(studentId: unknown, questionId: unknown): Promise<{ correct: boolean } | null | undefined> {
  try {
    return await PracticeAnswer.findOne({ studentId, questionId }).select("correct").lean<{ correct: boolean }>();
  } catch (error) {
    console.error("[engagement] reading the previous answer failed", error);
    return undefined;
  }
}

/**
 * POST /api/pyq/answer. First try ever: right = 10 × difficulty, wrong = 2.
 * A question whose last answer was wrong, now right: 15, once per question per IST day.
 * Re-answering a question already answered right earns nothing.
 */
export function practiceEngagement(
  student: AwardStudent,
  question: { _id: unknown; difficulty?: string | null; subject?: string; chapter?: string; topic?: string },
  answer: { correct: boolean; prev: { correct: boolean } | null | undefined },
  at = new Date()
) {
  return safely(async () => {
    if (answer.prev === undefined) return null; // couldn't tell first try from a retry: award nothing
    const sid = String(student._id);
    const qid = String(question._id);
    const meta = { questionId: qid, subject: question.subject, chapter: question.chapter, topic: question.topic, difficulty: question.difficulty ?? null };
    if (!answer.prev) {
      const xp = answer.correct ? ENGAGEMENT.xp.practiceCorrect * difficultyOf(question.difficulty) : ENGAGEMENT.xp.practiceWrong;
      return safeAward({
        student, kind: answer.correct ? "practice.correct" : "practice.wrong", key: `practice:${sid}:${qid}:first`, xp, meta, at,
        practice: true, counts: { question: true, correct: answer.correct },
      });
    }
    if (!answer.prev.correct && answer.correct) {
      return safeAward({
        student, kind: "mistake.fixed", key: `fix:${sid}:${qid}:${istDate(at)}`, xp: ENGAGEMENT.xp.mistakeFixed, meta, at,
        practice: true, counts: { question: true, correct: true, fixed: true },
      });
    }
    return engagementSnapshot(student, at);
  });
}

/** POST /api/self-assessments/[id]/submit: 3 XP per attempted question, at most 120, once per assessment. */
export function selfAssessmentEngagement(
  student: AwardStudent,
  assessment: { _id: unknown; submittedAt: Date | null; subject?: string; answers: { selected: string | null }[] },
  at = new Date()
) {
  return safely(async () => {
    if (!assessment.submittedAt) return engagementSnapshot(student, at);
    const attempted = assessment.answers.filter((a) => a.selected !== null && a.selected !== undefined && a.selected !== "").length;
    const xp = Math.min(ENGAGEMENT.xp.selfMax, attempted * ENGAGEMENT.xp.selfPerQuestion);
    if (xp <= 0) return engagementSnapshot(student, at);
    return safeAward({
      student, kind: "self.submitted", key: `self:${String(student._id)}:${String(assessment._id)}`, xp, at,
      meta: { assessmentId: String(assessment._id), subject: assessment.subject, attempted },
    });
  });
}

/** The fields of a finished test attempt the test award needs. */
export interface FinishedAttempt {
  testId: unknown;
  studentId: unknown;
  tuitionId: unknown;
  batchId?: unknown;
  startedAt: Date;
  submittedAt: Date | null;
}

/**
 * A finished assigned test (submitted, auto-submitted or teacher-finalized):
 * 80 XP for taking part, never based on marks. The IST day the student wrote it
 * (startedAt) counts as a streak day if that is still today. Never for an attempt
 * that isn't submitted (a paused attempt has no submittedAt).
 * Call only after the test lock has been released.
 */
export function testEngagement(attempt: FinishedAttempt, at = new Date()) {
  return safely(async () => {
    if (!attempt.submittedAt) return null;
    const student: AwardStudent = { _id: String(attempt.studentId), tuitionId: String(attempt.tuitionId), batchId: attempt.batchId ? String(attempt.batchId) : null };
    return safeAward({
      student, kind: "test.submitted", key: `test:${String(attempt.studentId)}:${String(attempt.testId)}`, xp: ENGAGEMENT.xp.testSubmitted, at,
      streakDate: istDate(attempt.startedAt), meta: { testId: String(attempt.testId) },
    });
  });
}

/** testEngagement for many finished attempts (End Test, results release). Never throws. */
export async function testEngagements(attempts: FinishedAttempt[]) {
  for (const attempt of attempts) await testEngagement(attempt);
}
