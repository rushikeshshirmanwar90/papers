import { Types } from "mongoose";
import type { Session } from "@/lib/auth";
import { badRequest, HttpError, isObjectId, notFound, oneOf } from "@/lib/http";
import { cleanAnswer, scoreAnswers } from "@/lib/marking";
import { ANSWER_FIELDS, low, QUESTION_FIELDS } from "@/lib/practice";
import { practiceBankOf, pyqFilter, readSubject } from "@/lib/pyq";
import { PROGRAM_INFO, programOf, STANDARDS, type Program, type QuestionBank, type SchoolSubject, type Track } from "@/lib/school";
import { levelOf, schoolSubjectOf } from "@/lib/topic-stats";
import {
  allocate,
  buildReport,
  chooseQuestions,
  DIFFICULTIES,
  difficultyOf,
  MIXES,
  seededRandom,
  splitFor,
  type Cell,
  type Difficulty,
  type Mix,
  type PoolQuestion,
  type Unit,
} from "@/lib/assessment-pick";
import PracticeAnswer from "@/models/PracticeAnswer";
import Question from "@/models/Question";
import SelfAssessment, { type AssessmentScope, type SelfAssessmentDoc } from "@/models/SelfAssessment";
import type { TestQuestion } from "@/models/TestRoom";

// Self-assessment: a test the student makes for themselves from their
// program's past-year questions (JEE or NEET bank; other programs have none
// and can't make one). They pick chapters and topics, how many questions, the
// difficulty mix and a time limit; lib/assessment-pick.ts chooses the
// questions. Once submitted, the answers also count as practice (PracticeAnswer),
// so the Practice tab, Home's strong and weak topics and the teacher's view
// all learn from it.

export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 50;
export const MAX_CHAPTERS = 30;
export const MAX_DURATION = 300;
export const MARKS_PER_QUESTION = 4;
export const NEGATIVE_MARKS = 1;
/** How many a student may make in a day. */
export const DAILY_LIMIT = 40;
/** Answers sent a little after the time is up still count (slow networks). */
const GRACE_MS = 60 * 1000;
/** Most questions read to choose from (only the topics and levels the test uses are read). */
const POOL_LIMIT = 40000;

export interface Setup {
  /** The student's program's question bank. */
  bank: QuestionBank;
  subject: SchoolSubject;
  scope: AssessmentScope[];
  count: number;
  mix: Mix;
  durationMinutes: number | null;
  negativeMarking: boolean;
  /** From the plan the student saw, so the test made matches it. */
  seed?: number;
}

/** The student's choices from the request body, checked. Refused when their program has no question bank. */
export function readSetup(body: Record<string, unknown>, user: { program?: Program | null; track?: Track | null }): Setup {
  const bank = practiceBankOf(user);
  if (!bank) {
    const program = programOf(user);
    throw badRequest(`Self-assessments aren't available for ${program ? PROGRAM_INFO[program].label : "your program"} yet.`);
  }
  const subject = readSubject(typeof body.subject === "string" ? body.subject : null, user);
  if (!Array.isArray(body.scope) || body.scope.length === 0) throw badRequest("Pick at least one chapter.");
  if (body.scope.length > MAX_CHAPTERS) throw badRequest(`Pick at most ${MAX_CHAPTERS} chapters.`);
  const seen = new Set<string>();
  const scope: AssessmentScope[] = [];
  for (const raw of body.scope) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const standard = oneOf(entry, "standard", STANDARDS, "a class");
    const chapter = typeof entry.chapter === "string" ? entry.chapter.trim() : "";
    if (!chapter || chapter.length > 200) throw badRequest("A chapter name is missing or too long.");
    const topics = Array.isArray(entry.topics) ? entry.topics : [];
    if (topics.length > 200 || topics.some((t) => typeof t !== "string" || t.length > 200)) throw badRequest(`The topics of ${chapter} aren't valid.`);
    const key = `${standard}|${low(chapter)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scope.push({ standard, chapter, topics: [...new Set((topics as string[]).map((t) => t.trim()))] });
  }

  const count = Number(body.count);
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    throw badRequest(`Choose from ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions.`);
  }
  const mix = body.mix === undefined ? "smart" : oneOf(body, "mix", MIXES, "a difficulty mix");
  let durationMinutes: number | null = null;
  if (body.durationMinutes !== undefined && body.durationMinutes !== null) {
    const d = Number(body.durationMinutes);
    if (!Number.isInteger(d) || d < 1 || d > MAX_DURATION) throw badRequest(`The time limit must be from 1 to ${MAX_DURATION} minutes, or none.`);
    durationMinutes = d;
  }
  const seed = Number.isInteger(body.seed) && (body.seed as number) >= 0 && (body.seed as number) < 2 ** 31 ? (body.seed as number) : undefined;
  return { bank, subject, scope, count, mix, durationMinutes, negativeMarking: body.negativeMarking !== false, seed };
}

const unitKey = (standard: string, chapter: string, topic: string) => `${standard}|${low(chapter)}|${low(topic)}`;

/** Only questions that can be marked: an answer key that isn't "Bonus". */
const MARKABLE = { correctAnswer: { $nin: ["", null, "Bonus", "bonus", "BONUS"] } };

/** How many markable PYQs each class, chapter, topic and difficulty has, with the names as stored. */
interface BankCell {
  standard: string;
  chapter: string;
  topic: string;
  /** As stored ("" or anything unknown counts as Medium). */
  rawDifficulty: string;
  difficulty: Difficulty;
  n: number;
}

const CACHE_MS = 10 * 60 * 1000;
const cellCache = new Map<string, { at: number; cells: BankCell[] }>();

/** Forgets the cached counts (for tests that change the bank). */
export const clearAssessmentCache = () => cellCache.clear();

/** The subject's PYQ counts by topic and difficulty in a bank (cached briefly, like topic practice). */
async function bankCells(bank: QuestionBank, subject: SchoolSubject): Promise<BankCell[]> {
  const key = `${bank}|${subject}`;
  const hit = cellCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cells;
  const rows = await Question.aggregate<{ _id: { standard: string; chapter: string; topic: string | null; difficulty: string | null }; n: number }>([
    // The class first so the standard/subject/chapter/topic index is used.
    { $match: { standard: { $in: [...STANDARDS] }, ...pyqFilter(bank, subject), ...MARKABLE, chapter: { $nin: ["", null] } } },
    { $group: { _id: { standard: "$standard", chapter: "$chapter", topic: "$topic", difficulty: "$difficulty" }, n: { $sum: 1 } } },
  ]);
  const cells = rows.map((r) => ({
    standard: r._id.standard,
    chapter: r._id.chapter,
    topic: r._id.topic ?? "",
    rawDifficulty: r._id.difficulty ?? "",
    difficulty: difficultyOf(r._id.difficulty),
    n: r.n,
  }));
  cellCache.set(key, { at: Date.now(), cells });
  return cells;
}

export interface UnitInfo extends Unit {
  standard: string;
  chapter: string;
  topic: string;
  answered: number;
  correct: number;
}

/** A question the student has seen in these topics: where it is now, and how it went. */
interface Seen {
  id: string;
  unit: string;
  difficulty: Difficulty;
  tier: 1 | 2;
}

/**
 * What the test can use: the topics (units) picked, the bank's counts per
 * topic and level, the questions in them the student has seen (answered in
 * practice, or shown in a recent self-assessment), and their record per topic.
 */
async function bankFor(session: Session, setup: Setup) {
  const all = await bankCells(setup.bank, setup.subject);

  // Each picked chapter's topics, matched to the bank's names (trimmed, any case).
  const units = new Map<string, UnitInfo>();
  const inScope: BankCell[] = [];
  for (const s of setup.scope) {
    const wanted = new Set(s.topics.map(low));
    for (const c of all) {
      if (c.standard !== s.standard || low(c.chapter) !== low(s.chapter) || (wanted.size && !wanted.has(low(c.topic)))) continue;
      const key = unitKey(c.standard, c.chapter, c.topic);
      if (!units.has(key)) {
        units.set(key, { key, group: `${s.standard}|${low(s.chapter)}`, level: "not-enough", standard: c.standard, chapter: s.chapter, topic: c.topic.trim(), answered: 0, correct: 0 });
      }
      inScope.push(c);
    }
  }
  const empty = { units: [] as UnitInfo[], inScope, seen: new Map<string, Seen>(), history: { answered: 0, correct: 0 } };
  if (!units.size) return empty;

  const [answers, recent] = await Promise.all([
    PracticeAnswer.find({ studentId: session.user._id, subject: setup.subject })
      .select("questionId standard chapter topic correct")
      .lean<{ questionId: Types.ObjectId; standard: string; chapter: string; topic: string; correct: boolean }[]>(),
    // Questions shown in recent self-assessments: seen, so not "new" (copies carry where they were).
    SelfAssessment.find({ studentId: session.user._id, subject: setup.subject, submittedAt: { $ne: null } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("questions.sourceId questions.standard questions.chapter questions.topic questions.difficulty")
      .lean<{ questions: { sourceId: Types.ObjectId | null; standard: string; chapter: string; topic: string; difficulty: string }[] }[]>(),
  ]);

  // The student's record per topic, for Smart.
  for (const a of answers) {
    const u = units.get(unitKey(a.standard, a.chapter, a.topic ?? ""));
    if (!u) continue;
    u.answered += 1;
    if (a.correct) u.correct += 1;
  }
  for (const u of units.values()) u.level = levelOf(u.answered, u.correct);

  // Seen questions in these topics, with their level (looked up for the ones answered in practice).
  const seen = new Map<string, Seen>();
  for (const r of recent) {
    for (const q of r.questions) {
      const unit = unitKey(q.standard, q.chapter, q.topic ?? "");
      if (q.sourceId && units.has(unit)) seen.set(String(q.sourceId), { id: String(q.sourceId), unit, difficulty: difficultyOf(q.difficulty), tier: 1 });
    }
  }
  const answeredHere = answers.filter((a) => units.has(unitKey(a.standard, a.chapter, a.topic ?? "")));
  if (answeredHere.length) {
    const right = new Map(answeredHere.map((a) => [String(a.questionId), a.correct]));
    const docs = await Question.find({ _id: { $in: answeredHere.map((a) => a.questionId) } })
      .select("standard chapter topic difficulty")
      .lean<{ _id: Types.ObjectId; standard: string; chapter: string; topic: string | null; difficulty: string }[]>();
    for (const d of docs) {
      const unit = unitKey(d.standard, d.chapter, d.topic ?? "");
      if (units.has(unit)) seen.set(String(d._id), { id: String(d._id), unit, difficulty: difficultyOf(d.difficulty), tier: right.get(String(d._id)) ? 2 : 1 });
    }
  }

  const list = [...units.values()];
  return {
    units: list,
    inScope,
    seen,
    history: { answered: list.reduce((n, u) => n + u.answered, 0), correct: list.reduce((n, u) => n + u.correct, 0) },
  };
}

/** A fresh seed for a plan; the app sends it back to make that same plan. */
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * What the test would be, from counts alone (no questions read): how many
 * questions of each level and topic, and why Smart chose its split.
 */
export async function planFor(session: Session, setup: Setup) {
  const seed = setup.seed ?? newSeed();
  const bank = await bankFor(session, setup);
  const { split, basis } = splitFor(setup.mix, bank.history);

  // Counts per topic and level; the seen ones aren't new.
  const cells = new Map<string, Cell>();
  for (const c of bank.inScope) {
    const unit = unitKey(c.standard, c.chapter, c.topic);
    const key = `${unit}#${c.difficulty}`;
    const cell = cells.get(key) ?? { unit, difficulty: c.difficulty, total: 0, fresh: 0 };
    cell.total += c.n;
    cell.fresh += c.n;
    cells.set(key, cell);
  }
  for (const s of bank.seen.values()) {
    const cell = cells.get(`${s.unit}#${s.difficulty}`);
    if (cell) cell.fresh = Math.max(0, cell.fresh - 1);
  }

  const { allocation, plan } = allocate({ cells: [...cells.values()], units: bank.units, count: setup.count, split, smart: setup.mix === "smart", random: seededRandom(seed) });
  const byUnit = new Map(plan.byUnit.map((u) => [u.key, u.count]));
  const availableIn = (key: string) => [...cells.values()].filter((c) => c.unit === key).reduce((n, c) => n + c.total, 0);
  return {
    seed,
    plan,
    basis,
    allocation,
    bank,
    topics: bank.units.map((u) => ({
      standard: u.standard,
      chapter: u.chapter,
      topic: u.topic,
      count: byUnit.get(u.key) ?? 0,
      available: availableIn(u.key),
      level: u.level,
      accuracy: u.answered ? Math.round((u.correct / u.answered) * 100) : null,
    })),
  };
}

/**
 * The questions for a plan: reads only the topics and levels it uses, then
 * takes new ones first, then ones answered wrongly, then right.
 */
async function questionsFor(session: Session, setup: Setup, planned: Awaited<ReturnType<typeof planFor>>): Promise<PoolQuestion[]> {
  const used = new Set<string>();
  for (const [unit, split] of planned.allocation) for (const d of DIFFICULTIES) if (split[d]) used.add(`${unit}#${d}`);
  const cells = planned.bank.inScope.filter((c) => used.has(`${unitKey(c.standard, c.chapter, c.topic)}#${c.difficulty}`));
  if (!cells.length) return [];

  // One clause per stored chapter, topic and difficulty used.
  const clauses = cells.map((c) => ({
    standard: c.standard,
    chapter: c.chapter,
    topic: c.topic === "" ? { $in: ["", null] } : c.topic,
    difficulty: c.rawDifficulty === "" ? { $in: ["", null] } : c.rawDifficulty,
  }));
  const rows = await Question.find({ ...pyqFilter(setup.bank, setup.subject), ...MARKABLE, $or: clauses })
    .select("_id standard chapter topic difficulty")
    .limit(POOL_LIMIT)
    .lean<{ _id: Types.ObjectId; standard: string; chapter: string; topic: string | null; difficulty: string }[]>();
  const pool: PoolQuestion[] = rows.map((q) => {
    const id = String(q._id);
    return { id, unit: unitKey(q.standard, q.chapter, q.topic ?? ""), difficulty: difficultyOf(q.difficulty), tier: planned.bank.seen.get(id)?.tier ?? 0 };
  });
  return chooseQuestions(pool, planned.allocation, seededRandom(planned.seed + 1));
}

/** "Kinematics", "Kinematics · Projectile Motion", "Kinematics · 3 topics", "Kinematics + 2 chapters". */
export function titleOf(scope: AssessmentScope[]): string {
  const [first] = scope;
  if (scope.length > 1) return `${first.chapter} + ${scope.length - 1} chapter${scope.length === 2 ? "" : "s"}`;
  if (first.topics.length === 1) return `${first.chapter} · ${first.topics[0]}`;
  if (first.topics.length > 1) return `${first.chapter} · ${first.topics.length} topics`;
  return first.chapter;
}

/** Makes the assessment (not started yet), with its questions chosen and copied. */
export async function createAssessment(session: Session, setup: Setup) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if ((await SelfAssessment.countDocuments({ studentId: session.user._id, createdAt: { $gte: since } })) >= DAILY_LIMIT) {
    throw new HttpError(429, `You can make up to ${DAILY_LIMIT} self-assessments a day. Finish or delete some first.`);
  }
  const planned = await planFor(session, setup);
  const chosen = planned.plan.count >= MIN_QUESTIONS ? await questionsFor(session, setup, planned) : [];
  if (chosen.length < MIN_QUESTIONS) {
    const total = planned.plan.available.total;
    throw badRequest(
      total
        ? `These topics have only ${total} past-year question${total === 1 ? "" : "s"}. Pick more topics (at least ${MIN_QUESTIONS} questions are needed).`
        : "There are no past-year questions in these topics yet. Pick other topics."
    );
  }

  const docs = await Question.find({ _id: { $in: chosen.map((q) => new Types.ObjectId(q.id)) } })
    .select(`${QUESTION_FIELDS} ${ANSWER_FIELDS} subject difficulty`)
    .lean<Record<string, unknown>[]>();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const questions: TestQuestion[] = chosen
    .map((p) => byId.get(p.id))
    .filter((d): d is Record<string, unknown> => !!d)
    .map((d) => copyOf(d));
  const plan = { Easy: 0, Medium: 0, Hard: 0 };
  for (const q of chosen) plan[q.difficulty] += 1;

  const doc = (await SelfAssessment.create({
    tuitionId: session.tuitionId,
    studentId: session.user._id,
    subject: setup.subject,
    title: titleOf(setup.scope),
    scope: setup.scope,
    mix: setup.mix,
    plan: { ...plan, fresh: chosen.filter((q) => q.tier === 0).length, requested: setup.count },
    basis: planned.basis,
    questions,
    marksPerQuestion: MARKS_PER_QUESTION,
    negativeMarks: setup.negativeMarking ? NEGATIVE_MARKS : 0,
    durationMinutes: setup.durationMinutes,
    maxScore: questions.length * MARKS_PER_QUESTION,
  })) as SelfAssessmentDoc;
  return doc;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const urls = (v: unknown) => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : []);

function copyOf(d: Record<string, unknown>): TestQuestion {
  const o = (d.optionDiagramUrls ?? {}) as Record<string, unknown>;
  return {
    sourceId: d._id as Types.ObjectId,
    subject: str(d.subject),
    standard: str(d.standard),
    chapter: str(d.chapter),
    topic: str(d.topic).trim(),
    difficulty: difficultyOf(d.difficulty),
    questionText: str(d.questionText),
    optionA: str(d.optionA),
    optionB: str(d.optionB),
    optionC: str(d.optionC),
    optionD: str(d.optionD),
    answerType: str(d.answerType) || "MCQ",
    correctAnswer: str(d.correctAnswer).trim(),
    explanation: str(d.explanation),
    diagramUrls: urls(d.diagramUrls),
    optionDiagramUrls: { A: urls(o.A), B: urls(o.B), C: urls(o.C), D: urls(o.D) },
    explanationDiagramUrls: urls(d.explanationDiagramUrls),
  };
}

// ─── Taking it ─────────────────────────────────────────────────────────────

/** When time is up; null without a time limit or before it starts. */
export function deadlineOf(a: Pick<SelfAssessmentDoc, "startedAt" | "durationMinutes">): Date | null {
  if (!a.startedAt || !a.durationMinutes) return null;
  return new Date(a.startedAt.getTime() + a.durationMinutes * 60 * 1000);
}

const timeUp = (a: SelfAssessmentDoc, now = Date.now()) => {
  const deadline = deadlineOf(a);
  return !!deadline && now > deadline.getTime() + GRACE_MS;
};

export const stateOf = (a: Pick<SelfAssessmentDoc, "startedAt" | "submittedAt">) =>
  a.submittedAt ? ("submitted" as const) : a.startedAt ? ("in-progress" as const) : ("ready" as const);

/** The student's own assessment, finished first if its time ran out while they were away. */
export async function assessmentFor(session: Session, id: unknown): Promise<SelfAssessmentDoc> {
  if (!isObjectId(id)) throw notFound("This self-assessment");
  const a = (await SelfAssessment.findOne({ _id: id, studentId: session.user._id })) as SelfAssessmentDoc | null;
  if (!a) throw notFound("This self-assessment");
  if (a.startedAt && !a.submittedAt && timeUp(a)) await finalize(a);
  return a;
}

export async function start(a: SelfAssessmentDoc) {
  if (a.startedAt) return a;
  a.startedAt = new Date();
  await a.save();
  return a;
}

/** Saves answers ({ index, selected }) while it's in progress. */
export function mergeAnswers(a: SelfAssessmentDoc, raw: unknown) {
  if (a.submittedAt) throw new HttpError(400, "You've already submitted this self-assessment.");
  if (!a.startedAt) throw new HttpError(400, "Start the self-assessment first.");
  if (timeUp(a)) throw new HttpError(400, "Time is up for this self-assessment.");
  if (!Array.isArray(raw)) throw new HttpError(400, "Send the answers as a list.");
  const byIndex = new Map(a.answers.map((x) => [x.index, x.selected]));
  for (const entry of raw.slice(0, a.questions.length)) {
    const { index, selected } = (entry ?? {}) as { index?: unknown; selected?: unknown };
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= a.questions.length) continue;
    byIndex.set(index as number, cleanAnswer(a.questions[index as number], selected));
  }
  a.answers = [...byIndex.entries()].sort((x, y) => x[0] - y[0]).map(([index, selected]) => ({ index, selected, correct: null }));
}

/**
 * Marks it and closes it. The answered questions also count as practice: the
 * student's latest answer to each is kept, as answering it in Practice would.
 */
export async function finalize(a: SelfAssessmentDoc, now = new Date()) {
  if (a.submittedAt) return a;
  if (!a.startedAt) throw new HttpError(400, "Start the self-assessment first.");
  const given = new Map(a.answers.map((x) => [x.index, x.selected]));
  const result = scoreAnswers(a.questions, given, a.marksPerQuestion, a.negativeMarks);
  const deadline = deadlineOf(a);
  const end = deadline && now > deadline ? deadline : now;
  a.set({
    answers: result.answers,
    score: result.score,
    maxScore: result.maxScore,
    correctCount: result.correctCount,
    wrongCount: result.wrongCount,
    skippedCount: result.skippedCount,
    submittedAt: end,
    timeTakenSeconds: Math.max(0, Math.round((end.getTime() - a.startedAt.getTime()) / 1000)),
  });
  await a.save();

  const practice = result.answers
    .filter((x) => x.selected !== null && x.correct !== null && a.questions[x.index]?.sourceId)
    .map((x) => {
      const q = a.questions[x.index];
      return {
        updateOne: {
          filter: { studentId: a.studentId, questionId: q.sourceId },
          update: {
            $set: {
              tuitionId: a.tuitionId,
              subject: schoolSubjectOf(q.subject),
              standard: q.standard,
              chapter: q.chapter,
              topic: q.topic,
              selected: x.selected,
              correct: x.correct,
              answeredAt: end,
            },
          },
          upsert: true,
        },
      };
    });
  if (practice.length) {
    // The result is saved already; practice progress catching up is a bonus.
    await PracticeAnswer.bulkWrite(practice, { ordered: false }).catch((error) => console.error("[self-assessment] practice answers", error));
  }
  return a;
}

// ─── What the app gets ─────────────────────────────────────────────────────

/** The topic report; questions and answers as plain objects (Mongoose sub-documents don't spread). */
const reportOf = (a: SelfAssessmentDoc) =>
  buildReport(
    a.questions.map((q) => ({ standard: q.standard ?? "", chapter: q.chapter ?? "", topic: q.topic ?? "", difficulty: q.difficulty ?? "" })),
    a.answers.map((x) => ({ index: x.index, selected: x.selected ?? null, correct: x.correct ?? null }))
  );

/** One line for lists: what it covers, how it's set up, and the result once submitted. */
export function summaryOf(a: SelfAssessmentDoc) {
  const state = stateOf(a);
  const report = state === "submitted" ? reportOf(a) : null;
  return {
    id: String(a._id),
    title: a.title,
    subject: a.subject,
    mix: a.mix,
    state,
    scope: a.scope.map((s) => ({ standard: s.standard, chapter: s.chapter, topics: s.topics })),
    questionCount: a.questions.length,
    plan: { Easy: a.plan?.Easy ?? 0, Medium: a.plan?.Medium ?? 0, Hard: a.plan?.Hard ?? 0, fresh: a.plan?.fresh ?? 0, requested: a.plan?.requested ?? a.questions.length },
    basis: { kind: a.basis?.kind ?? "fixed", accuracy: a.basis?.accuracy ?? null, answered: a.basis?.answered ?? 0 },
    marksPerQuestion: a.marksPerQuestion,
    negativeMarks: a.negativeMarks,
    maxScore: a.questions.length * a.marksPerQuestion,
    durationMinutes: a.durationMinutes,
    createdAt: a.createdAt,
    startedAt: a.startedAt,
    deadline: deadlineOf(a),
    submittedAt: a.submittedAt,
    answeredCount: a.answers.filter((x) => x.selected !== null).length,
    result: report
      ? {
          score: a.score,
          maxScore: a.maxScore,
          correct: a.correctCount,
          wrong: a.wrongCount,
          skipped: a.skippedCount,
          timeTakenSeconds: a.timeTakenSeconds,
          strength: report.overall.strength,
          strongTopics: report.strongTopics,
          weakTopics: report.weakTopics,
        }
      : null,
  };
}

/** Everything for one assessment: the questions once started (answers and solutions once submitted), and the report. */
export function detailOf(a: SelfAssessmentDoc) {
  const state = stateOf(a);
  const reveal = state === "submitted";
  return {
    assessment: summaryOf(a),
    answers: a.answers.map((x) => ({ index: x.index, selected: x.selected, correct: reveal ? x.correct : null })),
    // Not shown before Start, so the questions can't be read ahead of the clock.
    questions:
      state === "ready"
        ? []
        : a.questions.map((q, index) => ({
            index,
            subject: q.subject,
            standard: q.standard,
            chapter: q.chapter,
            topic: q.topic,
            questionText: q.questionText,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            answerType: q.answerType,
            diagramUrls: q.diagramUrls,
            optionDiagramUrls: q.optionDiagramUrls,
            ...(reveal
              ? { difficulty: q.difficulty, correctAnswer: q.correctAnswer, explanation: q.explanation, explanationDiagramUrls: q.explanationDiagramUrls }
              : {}),
          })),
    report: reveal ? reportOf(a) : null,
  };
}

/** The student's assessments, newest first; ones whose time ran out are finished first. */
export async function listFor(session: Session, subject: SchoolSubject | null) {
  const list = (await SelfAssessment.find({ studentId: session.user._id, ...(subject ? { subject } : {}) })
    .sort({ createdAt: -1 })
    .limit(50)) as SelfAssessmentDoc[];
  for (const a of list) if (a.startedAt && !a.submittedAt && timeUp(a)) await finalize(a);
  return list.map(summaryOf);
}
