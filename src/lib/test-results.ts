import type { Types } from "mongoose";
import { HttpError, notFound } from "@/lib/http";
import { finalizeExpired } from "@/lib/attempts";
import { monitorTest, stateOf, type MonitorRow, type MonitorState } from "@/lib/test-monitor";
import { maxScoreOf } from "@/lib/tests";
import { STRONG_FROM, WEAK_BELOW, schoolSubjectOf } from "@/lib/topic-stats";
import TestAttempt from "@/models/TestAttempt";
import type { TestRoomDoc } from "@/models/TestRoom";
import User from "@/models/User";

// Results and performance analytics for a test. Read-only: every figure comes from the
// finalized TestAttempts (their persisted score and counts, which finalize() in
// lib/attempts.ts produced) and the question copies held by the TestRoom. Nothing here
// scores an answer again or writes anything.
//
// Definitions, used everywhere so the numbers agree:
// - attempted: an attempt that was finalized (submitted, auto-submitted or ended by a violation).
//   Only these are ranked and averaged; students who never started are listed apart.
// - percentage: score / maximum marks, in percent to one decimal (negative when the score is).
// - accuracy: right answers / answered questions (right + wrong); null when nothing was answered.
// - unanswered: questions that are neither right nor wrong (skipped, or answered but with no answer key).
// - rank: 1 + the number of attempted students with a higher score. Equal scores share a rank.

/** A topic needs this many distinct questions answered by someone before it is called weak or strong. */
export const MIN_TOPIC_QUESTIONS = 2;
/** ...and this many answers in all: for a batch, and for one student. */
export const MIN_TOPIC_ANSWERS_BATCH = 5;
export const MIN_TOPIC_ANSWERS_STUDENT = 2;

type Answer = { index: number; selected: string | null; correct: boolean | null };

/** An attempt as the results need it. */
export interface AttemptRow {
  studentId: Types.ObjectId;
  score: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  timeTakenSeconds: number;
  startedAt: Date;
  submittedAt: Date | null;
  endedReason: "violation" | null;
  answers: Answer[];
}

const ATTEMPT_FIELDS = "studentId score maxScore correctCount wrongCount skippedCount timeTakenSeconds startedAt submittedAt endedReason answers";

type TestForResults = Pick<TestRoomDoc, "questions" | "marksPerQuestion" | "negativeMarks" | "durationMinutes" | "closesAt">;

// ─── Numbers ───────────────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100);
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** n as a percent of d to one decimal, or null when there is nothing to divide by. */
export const ratio = (n: number, d: number): number | null => (d > 0 && Number.isFinite(n) ? Math.round((n / d) * 1000) / 10 : null);

const mean = (values: number[]): number | null => (values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null);

// ─── Rankings ──────────────────────────────────────────────────────────────

/**
 * Highest score first. Equal scores get the same rank (1, 2, 2, 4); within a tie the
 * quicker attempt is listed first, then by name and id, so the order never changes between reads.
 */
export function rankRows<T extends { id: string; name: string; score: number; timeTakenSeconds: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort(
    (a, b) => cents(b.score) - cents(a.score) || a.timeTakenSeconds - b.timeTakenSeconds || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || cents(row.score) !== cents(sorted[i - 1].score)) rank = i + 1;
    return { ...row, rank };
  });
}

/** One student's rank among all the scores of a test, without needing anyone else's name or answers. */
export const rankOf = (score: number, scores: number[]) => 1 + scores.filter((s) => cents(s) > cents(score)).length;

/** Where a result sits against the same bands the teacher's other views use. */
export type Band = "top" | "average" | "needs-improvement";
export const bandOf = (percentage: number | null): Band => (percentage === null ? "average" : percentage >= STRONG_FROM ? "top" : percentage < WEAK_BELOW ? "needs-improvement" : "average");

// ─── One attempt ───────────────────────────────────────────────────────────

/** The headline figures of an attempt, from what finalize() stored. */
export function measuresOf(test: TestForResults, attempt: AttemptRow) {
  const max = attempt.maxScore > 0 ? attempt.maxScore : maxScoreOf(test as TestRoomDoc);
  const correct = attempt.correctCount ?? 0;
  const incorrect = attempt.wrongCount ?? 0;
  const score = round2(attempt.score ?? 0);
  return {
    score,
    maxScore: max,
    percentage: ratio(score, max),
    accuracy: ratio(correct, correct + incorrect),
    correct,
    incorrect,
    // Every question of the test is right, wrong or neither, so a legacy attempt without a skipped count still adds up.
    unanswered: Math.max(0, test.questions.length - correct - incorrect),
    negativeDeducted: round2(incorrect * test.negativeMarks),
    timeTakenSeconds: Math.max(0, attempt.timeTakenSeconds ?? 0),
  };
}

export type QuestionStatus = "correct" | "incorrect" | "unanswered" | "unmarked";

/** "unmarked": an answer was given but the question has no answer key to mark it by. */
export function statusOfAnswer(answer: Pick<Answer, "selected" | "correct"> | undefined): QuestionStatus {
  if (answer?.correct === true) return "correct";
  if (answer?.correct === false) return "incorrect";
  return answer?.selected !== undefined && answer?.selected !== null ? "unmarked" : "unanswered";
}

const answersByIndex = (attempt: Pick<AttemptRow, "answers">) => {
  const map = new Map<number, Answer>();
  for (const a of attempt.answers ?? []) if (!map.has(a.index)) map.set(a.index, a);
  return map;
};

// ─── Questions ─────────────────────────────────────────────────────────────

const OPTION_KEYS = ["A", "B", "C", "D"] as const;

/**
 * How each question went across the given (finalized) attempts. Rates:
 * correctRate and incorrectRate are shares of those who answered (right + wrong);
 * skipRate is the share of all the attempts. Null when there is nobody to divide by.
 */
export function questionStats(test: TestForResults, attempts: AttemptRow[]) {
  const maps = attempts.map(answersByIndex);
  return test.questions.map((q, index) => {
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    const options: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const map of maps) {
      const answer = map.get(index);
      const status = statusOfAnswer(answer);
      if (status === "correct") correct++;
      else if (status === "incorrect") incorrect++;
      else unanswered++;
      if (answer?.selected && answer.selected in options) options[answer.selected]++;
    }
    const answered = correct + incorrect;
    const key = (q.correctAnswer ?? "").trim();
    const bonus = key.toLowerCase() === "bonus";
    return {
      index,
      subject: q.subject,
      chapter: q.chapter,
      topic: q.topic,
      answerType: q.answerType,
      correctAnswer: q.correctAnswer,
      hasKey: !!key,
      bonus,
      attempts: attempts.length,
      answered,
      correct,
      incorrect,
      unanswered,
      correctRate: ratio(correct, answered),
      incorrectRate: ratio(incorrect, answered),
      skipRate: ratio(unanswered, attempts.length),
      /** How many picked each option: for a markable multiple-choice question only. Numerical answers have no options. */
      options: q.answerType === "Numerical" || bonus ? null : (Object.fromEntries(OPTION_KEYS.map((k) => [k, options[k]])) as Record<string, number>),
    };
  });
}

export type QuestionStat = ReturnType<typeof questionStats>[number];

/**
 * The question numbers (indexes) worth a teacher's attention, three of each at most: the most
 * right, wrong and skipped by head count (a rate over two answers would outrank one over thirty).
 * Ties go to the higher rate, then the earlier question.
 */
export function highlightsOf(stats: QuestionStat[]) {
  const top = (list: QuestionStat[], count: (s: QuestionStat) => number, rate: (s: QuestionStat) => number | null) =>
    [...list].sort((a, b) => count(b) - count(a) || (rate(b) ?? 0) - (rate(a) ?? 0) || a.index - b.index).slice(0, 3).map((s) => s.index);
  return {
    mostCorrect: top(stats.filter((s) => s.correct > 0 && !s.bonus), (s) => s.correct, (s) => s.correctRate),
    mostIncorrect: top(stats.filter((s) => s.incorrect > 0), (s) => s.incorrect, (s) => s.incorrectRate),
    mostSkipped: top(stats.filter((s) => s.unanswered > 0), (s) => s.unanswered, (s) => s.skipRate),
  };
}

// ─── Topics ────────────────────────────────────────────────────────────────

export type TopicLevel = "strong" | "average" | "weak" | "not-enough";

export interface TopicRow {
  subject: string;
  chapter: string;
  topic: string;
  /** What to call it: the topic, else the chapter, else "Unclassified". */
  label: string;
  /** False for questions that carry no chapter or topic. */
  classified: boolean;
  /** Questions of the test in this group. */
  questions: number;
  /** How many of them anyone answered. */
  questionsAnswered: number;
  /** Answers that could have been given: questions × attempts. */
  possible: number;
  attempted: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number | null;
  marks: number;
  maxMarks: number;
  level: TopicLevel;
}

/**
 * Accuracy per topic across the given attempts (one student's, or a batch's).
 * Groups come from the metadata the test's questions already carry (subject, chapter,
 * topic); a question without a chapter and topic goes to "Unclassified", never guessed
 * from its text. The test's questions have no subtopic, so there is no level below topic.
 */
export function topicPerformance(test: TestForResults, attempts: AttemptRow[], minAnswers: number): TopicRow[] {
  const maps = attempts.map(answersByIndex);
  const groups = new Map<string, TopicRow & { seen: Set<number> }>();
  test.questions.forEach((q, index) => {
    const chapter = (q.chapter ?? "").trim();
    const topic = (q.topic ?? "").trim();
    const classified = !!(chapter || topic);
    const subject = classified ? schoolSubjectOf((q.subject ?? "").trim()) : "";
    const key = classified ? `${subject}|${chapter.toLowerCase()}|${topic.toLowerCase()}` : "unclassified";
    let g = groups.get(key);
    if (!g) {
      g = { subject, chapter, topic, label: topic || chapter || "Unclassified", classified, questions: 0, questionsAnswered: 0, possible: 0, attempted: 0, correct: 0, incorrect: 0, unanswered: 0, accuracy: null, marks: 0, maxMarks: 0, level: "not-enough", seen: new Set() };
      groups.set(key, g);
    }
    g.questions++;
    g.possible += attempts.length;
    g.maxMarks += attempts.length * test.marksPerQuestion;
    for (const map of maps) {
      const status = statusOfAnswer(map.get(index));
      if (status === "correct") g.correct++;
      else if (status === "incorrect") g.incorrect++;
      else g.unanswered++;
      if (status === "correct" || status === "incorrect") g.seen.add(index);
    }
  });
  return [...groups.values()]
    .map(({ seen, ...g }) => {
      const attempted = g.correct + g.incorrect;
      const accuracy = ratio(g.correct, attempted);
      const enough = seen.size >= MIN_TOPIC_QUESTIONS && attempted >= minAnswers;
      const level: TopicLevel = !enough || accuracy === null ? "not-enough" : accuracy < WEAK_BELOW ? "weak" : accuracy >= STRONG_FROM ? "strong" : "average";
      return {
        ...g,
        attempted,
        questionsAnswered: seen.size,
        accuracy,
        marks: round2(g.correct * test.marksPerQuestion - g.incorrect * test.negativeMarks),
        maxMarks: round2(g.maxMarks),
        level,
      };
    })
    .sort((a, b) => Number(!a.classified) - Number(!b.classified) || a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter) || a.topic.localeCompare(b.topic));
}

/** Topics that are weak by the rule above, weakest first, each with a plain recommendation. Unclassified questions can't be named, so they are left out. */
export function weakTopics(topics: TopicRow[]) {
  return topics
    .filter((t) => t.classified && t.level === "weak")
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0) || b.attempted - a.attempted || a.label.localeCompare(b.label))
    .map((t) => ({ ...t, recommendation: `Revise ${t.label} concepts and practise more questions from this topic.` }));
}

// ─── The teacher's results ─────────────────────────────────────────────────

const FINALIZED: MonitorState[] = ["submitted", "auto-submitted", "violation"];

/** Everything the results screen shows, from the monitor's participation and the finalized attempts. Pure. */
export function buildResults(
  test: TestForResults,
  monitor: { counts: { total: number; notStarted: number; inProgress: number; submitted: number; autoSubmitted: number; violations: number }; students: MonitorRow[] },
  attempts: AttemptRow[]
) {
  const byStudent = new Map(attempts.filter((a) => a.submittedAt).map((a) => [String(a.studentId), a]));
  const finished = monitor.students.filter((s) => FINALIZED.includes(s.state) && byStudent.has(s.student.id));
  const rows = finished.map((s) => {
    const m = measuresOf(test, byStudent.get(s.student.id)!);
    return { id: s.student.id, name: s.student.name, state: s.state as "submitted" | "auto-submitted" | "violation", ...m, band: bandOf(m.percentage) };
  });
  const rankings = rankRows(rows).map(({ id, name, ...r }) => ({ ...r, student: { id, name } }));
  const used = finished.map((s) => byStudent.get(s.student.id)!);

  const { counts } = monitor;
  const accuracies = rankings.map((r) => r.accuracy).filter((a): a is number => a !== null);
  const percentages = rankings.map((r) => r.percentage).filter((p): p is number => p !== null);
  const scores = rankings.map((r) => r.score);
  const stats = questionStats(test, used);
  const topics = topicPerformance(test, used, MIN_TOPIC_ANSWERS_BATCH);

  return {
    summary: {
      total: counts.total,
      attempted: rankings.length,
      notAttempted: counts.notStarted,
      inProgress: counts.inProgress,
      submissionRate: ratio(rankings.length, counts.total),
      normal: rankings.filter((r) => r.state === "submitted").length,
      autoSubmitted: rankings.filter((r) => r.state === "auto-submitted").length,
      violations: rankings.filter((r) => r.state === "violation").length,
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      averageScore: mean(scores),
      averagePercentage: percentages.length ? Math.round((percentages.reduce((a, b) => a + b, 0) / percentages.length) * 10) / 10 : null,
      // Students who answered nothing have no accuracy, so they are left out of this average only.
      averageAccuracy: accuracies.length ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10 : null,
    },
    rankings,
    notAttempted: monitor.students.filter((s) => s.state === "not-started").map((s) => s.student),
    questions: stats,
    highlights: highlightsOf(stats),
    topics,
    weakTopics: weakTopics(topics),
  };
}

/**
 * The results of a test for its teachers and tuition. The caller has already checked the user may
 * see the test (testFor). Participation comes from the live monitor, so the two never disagree; attempts
 * whose time ran out are scored first (monitorTest does it), then read once, with their answers.
 *
 * A finished attempt is history: it stays in the ranking and averages whatever became of the student
 * (moved to another batch, turned off, or removed from the tuition). The monitor only lists current
 * members, so such students are added from their attempts, which are already limited to this test's
 * tuition and batch. "Total students" is therefore today's batch roster plus these former students, and
 * summary.former says how many they are. Limitation: a student who never started and has since left isn't known, and one who joined
 * the batch later shows as not attempted (there is no enrollment history).
 */
export async function resultsOf(test: TestRoomDoc) {
  const monitor = await monitorTest(test);
  const attempts = await TestAttempt.find({ testId: test._id, tuitionId: test.tuitionId, batchId: test.batchId }).select(ATTEMPT_FIELDS).lean<AttemptRow[]>();
  const listed = new Set(monitor.students.map((r) => r.student.id));
  const former = attempts.filter((a) => a.submittedAt && !listed.has(String(a.studentId)));
  if (former.length) {
    const users = await User.find({ _id: { $in: former.map((a) => a.studentId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
    const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
    const counts = { ...monitor.counts };
    const rows: MonitorRow[] = former.map((a) => {
      const state = stateOf(test, a);
      counts.total++;
      counts.submitted++;
      if (state === "auto-submitted") counts.autoSubmitted++;
      if (state === "violation") counts.violations++;
      return { student: { id: String(a.studentId), name: nameOf.get(String(a.studentId)) ?? "Former student" }, state, answered: 0, total: test.questions.length, startedAt: a.startedAt, submittedAt: a.submittedAt, remainingSeconds: null };
    });
    const built = buildResults(test, { counts, students: [...monitor.students, ...rows] }, attempts);
    return { status: monitor.status, ...built, summary: { ...built.summary, former: rows.length } };
  }
  const built = buildResults(test, monitor, attempts);
  return { status: monitor.status, ...built, summary: { ...built.summary, former: 0 } };
}

/** One student's attempt in full, for a teacher: the headline figures, rank and every question with the answer given. */
export async function studentResultOf(test: TestRoomDoc, studentId: string) {
  await finalizeExpired(test);
  const [student, attempt, scores] = await Promise.all([
    // The attempt (limited to this tuition below) is what authorizes the read, so a student who has since left is still found.
    User.findById(studentId).select("name").lean<{ _id: Types.ObjectId; name: string }>(),
    TestAttempt.findOne({ testId: test._id, tuitionId: test.tuitionId, studentId }).select(ATTEMPT_FIELDS).lean<AttemptRow>(),
    TestAttempt.find({ testId: test._id, tuitionId: test.tuitionId, submittedAt: { $ne: null } }).select("score").lean<{ score: number }[]>(),
  ]);
  if (!attempt) throw notFound("This student's result");
  if (!attempt.submittedAt) throw new HttpError(409, "This student hasn't finished the test yet.");

  const m = measuresOf(test, attempt);
  const answers = answersByIndex(attempt);
  const topics = topicPerformance(test, [attempt], MIN_TOPIC_ANSWERS_STUDENT);
  return {
    student: { id: String(attempt.studentId), name: student?.name ?? "Former student" },
    state: stateOf(test, attempt),
    rank: rankOf(m.score, scores.map((s) => s.score)),
    ranked: scores.length,
    ...m,
    submittedAt: attempt.submittedAt,
    questions: test.questions.map((q, index) => {
      const answer = answers.get(index);
      const status = statusOfAnswer(answer);
      return {
        index,
        status,
        selected: answer?.selected ?? null,
        marks: status === "correct" ? test.marksPerQuestion : status === "incorrect" ? -test.negativeMarks : 0,
        question: {
          subject: q.subject,
          chapter: q.chapter,
          topic: q.topic,
          questionText: q.questionText,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          answerType: q.answerType,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          diagramUrls: q.diagramUrls,
          optionDiagramUrls: q.optionDiagramUrls,
          explanationDiagramUrls: q.explanationDiagramUrls,
        },
      };
    }),
    topics,
    weakTopics: weakTopics(topics),
  };
}

/**
 * A student's own analytics once the test's results are released: the same figures a teacher sees for them,
 * and their rank as a number. The caller checks the release (resultsReleased) and that the attempt is
 * the requester's; nothing about any other student is returned, only how many were ranked.
 */
export async function ownAnalytics(test: TestRoomDoc, attempt: AttemptRow & { tuitionId: Types.ObjectId }) {
  const scores = await TestAttempt.find({ testId: test._id, tuitionId: attempt.tuitionId, submittedAt: { $ne: null } }).select("score").lean<{ score: number }[]>();
  const m = measuresOf(test, attempt);
  const topics = topicPerformance(test, [attempt], MIN_TOPIC_ANSWERS_STUDENT);
  return {
    rank: rankOf(m.score, scores.map((s) => s.score)),
    ranked: scores.length,
    percentage: m.percentage,
    accuracy: m.accuracy,
    unanswered: m.unanswered,
    negativeDeducted: m.negativeDeducted,
    topics,
    weakTopics: weakTopics(topics),
  };
}
