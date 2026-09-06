import { MARKING_SCHEME } from "@shared/types";
import type { QuestionDoc } from "@/models/Question";

export interface GivenAnswerInput {
  questionId: string;
  selected: string | null;
}

// Applies the +4/-1/0 marking scheme against a paper's questions for a given
// set of submitted answers. Used both when an attempt is first submitted and
// when re-rendering a past attempt's review.
export function buildReview(questions: QuestionDoc[], answers: GivenAnswerInput[]) {
  const answerMap = new Map(answers.map((a) => [a.questionId, a.selected]));

  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  const review = questions.map((q) => {
    const selected = answerMap.get(String(q._id)) ?? null;
    const isSkipped = selected === null || selected === undefined || selected === "";
    const isBonus = q.correctAnswer === "Bonus";
    const isCorrect =
      !isSkipped && !isBonus && String(selected).toUpperCase() === String(q.correctAnswer).toUpperCase();

    let marksAwarded = 0;
    if (isBonus) {
      marksAwarded = MARKING_SCHEME.CORRECT;
      correctCount++;
    } else if (isSkipped) {
      marksAwarded = MARKING_SCHEME.SKIPPED;
      skippedCount++;
    } else if (isCorrect) {
      marksAwarded = MARKING_SCHEME.CORRECT;
      correctCount++;
    } else {
      marksAwarded = MARKING_SCHEME.WRONG;
      wrongCount++;
    }

    score += marksAwarded;

    return {
      questionId: String(q._id),
      selected,
      correctAnswer: q.correctAnswer,
      isCorrect: isCorrect || isBonus,
      isSkipped,
      marksAwarded,
      question: q,
    };
  });

  return { review, score, correctCount, wrongCount, skippedCount, totalQuestions: questions.length };
}
