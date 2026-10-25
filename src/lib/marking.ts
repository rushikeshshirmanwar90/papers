// Marking answers to tuition tests and PYQ practice. (Uploaded-paper attempts
// use lib/scoring.ts.)

export interface Markable {
  answerType: string;
  correctAnswer: string;
}

/** A student's answer as stored: "A"–"D", a number as text, or null for skipped. */
export function cleanAnswer(q: Markable, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().slice(0, 40);
  if (!text) return null;
  if (q.answerType === "Numerical") return text;
  const letter = text.toUpperCase();
  return /^[ABCD]$/.test(letter) ? letter : null;
}

const asNumber = (text: string) => Number(text.replace(/[,\s]/g, ""));

/**
 * Whether the answer is right; null when the question can't be marked (no
 * answer key) or wasn't answered. Numerical answers match within 0.01 (or
 * 1% for large numbers); otherwise as text, ignoring spaces and case.
 */
export function isCorrect(q: Markable, selected: string | null): boolean | null {
  const key = (q.correctAnswer ?? "").trim();
  // A dropped question: everyone gets its marks (as lib/scoring.ts does for papers).
  if (key.toLowerCase() === "bonus") return true;
  if (selected === null) return null;
  if (!key) return null;
  if (q.answerType === "Numerical") {
    const a = asNumber(selected);
    const b = asNumber(key);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01);
    return selected.replace(/\s+/g, "").toLowerCase() === key.replace(/\s+/g, "").toLowerCase();
  }
  return selected.toUpperCase() === key.toUpperCase();
}

/** Marks every question of an attempt and adds up the score. */
export function scoreAnswers(
  questions: Markable[],
  given: Map<number, string | null>,
  marksPerQuestion: number,
  negativeMarks: number
) {
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  const answers = questions.map((q, index) => {
    const selected = given.get(index) ?? null;
    const correct = isCorrect(q, selected);
    if (correct === true) correctCount++;
    else if (correct === false) wrongCount++;
    else skippedCount++;
    return { index, selected, correct };
  });
  return {
    answers,
    correctCount,
    wrongCount,
    skippedCount,
    score: correctCount * marksPerQuestion - wrongCount * negativeMarks,
    maxScore: questions.length * marksPerQuestion,
  };
}
