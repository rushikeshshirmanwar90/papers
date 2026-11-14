import { Types } from "mongoose";
import { bankSubjects, examConditions } from "@/lib/examFilter";
import { type ExamId } from "@/lib/examBank";
import { buildFilter } from "@/lib/queryFilters";
import { LEVEL_SPELLINGS, LEVELS, levelOf, planPick, zeroMix, type ChapterCapacity, type Mix, type Quota } from "@/lib/questionPickPlan";
import Question, { NOT_A_BANK_COPY, NOT_FLAGGED } from "@/models/Question";

// Automatic question selection for a PDF: `count` questions drawn at random
// from the question bank, for one exam, subject and the chosen chapters.
//
// Only real, eligible bank questions are ever returned: never invented, and
// never from another exam, subject or chapter. When the bank has fewer than
// asked, the answer says how many it found and how many exist (per level), and
// the teacher decides what to do; nothing is topped up from somewhere else.
//
// The questions are drawn a few at a time from each chapter (and level), so
// every chosen chapter has its share, and only their ids are sampled in the
// database: the questions themselves are read once, for the ones picked.

export { LEVELS, MAX_EXCLUDED, MAX_PICK, distribute, levelOf, planPick } from "@/lib/questionPickPlan";
export type { ChapterCapacity, Level, Mix, Plan, Quota, Take } from "@/lib/questionPickPlan";

// ─── The bank ───────────────────────────────────────────────────────────────

export interface PickRequest {
  exam: ExamId;
  subject: string;
  /** None: every chapter of the subject. */
  chapters: string[];
  topics: string[];
  quota: Quota;
  /** MCQ, Numerical, or both (any); Descriptive questions are never picked. */
  answerType: "MCQ" | "Numerical" | "any";
  /** Questions to leave out, e.g. those in PDFs already made. */
  exclude: string[];
}

export interface PickResult {
  questions: Record<string, unknown>[];
  requested: number;
  found: number;
  /** Everything eligible for this selection, by level (after leaving out `exclude`). */
  available: Mix & { total: number };
  /** Eligible questions that were left out because they were asked to be. */
  avoided: number;
  foundByLevel: Mix;
  requestedByLevel: Mix | null;
}

/** The conditions every pick (and every count) shares, without the left-out ids. */
function scopeFilter(request: PickRequest): Record<string, unknown> {
  const params = new URLSearchParams();
  for (const chapter of request.chapters) params.append("chapter", chapter);
  for (const topic of request.topics) params.append("topic", topic);
  const filter = buildFilter(params, "subject");
  return {
    ...filter,
    ...NOT_A_BANK_COPY,
    ...NOT_FLAGGED,
    $and: examConditions(request.exam),
    subject: { $in: bankSubjects(request.subject) },
    answerType: request.answerType === "any" ? { $nin: ["Descriptive"] } : request.answerType,
  };
}

/** Sampling queries sent to the database at a time. */
const SAMPLE_CONCURRENCY = 6;

const sameChapter = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function pickFromBank(request: PickRequest): Promise<PickResult> {
  const scope = scopeFilter(request);
  const excluded = request.exclude.map((id) => new Types.ObjectId(id));
  const eligible = excluded.length ? { ...scope, _id: { $nin: excluded } } : scope;

  const [groups, avoided] = await Promise.all([
    Question.aggregate<{ _id: { chapter: string | null; difficulty: string | null }; n: number }>([
      { $match: eligible },
      { $group: { _id: { chapter: "$chapter", difficulty: "$difficulty" }, n: { $sum: 1 } } },
    ]),
    excluded.length ? Question.countDocuments({ ...scope, _id: { $in: excluded } }) : 0,
  ]);

  // Chapters as the bank spells them, in the order the teacher listed them (the rest after, by name).
  const capacities = new Map<string, ChapterCapacity>();
  for (const { _id, n } of groups) {
    const chapter = (_id.chapter ?? "").trim();
    if (!chapter) continue;
    const entry = capacities.get(chapter.toLowerCase()) ?? { chapter, levels: zeroMix() };
    entry.levels[levelOf(_id.difficulty)] += n;
    capacities.set(chapter.toLowerCase(), entry);
  }
  const order = (chapter: string) => {
    const at = request.chapters.findIndex((name) => sameChapter(name, chapter));
    return at < 0 ? request.chapters.length : at;
  };
  const chapters = [...capacities.values()].sort((a, b) => order(a.chapter) - order(b.chapter) || a.chapter.localeCompare(b.chapter, undefined, { numeric: true }));

  const available = { ...zeroMix(), total: 0 };
  for (const { levels } of chapters) for (const level of LEVELS) available[level] += levels[level];
  available.total = LEVELS.reduce((sum, level) => sum + available[level], 0);

  const plan = planPick(chapters, request.quota);

  // Sample ids bucket by bucket; read the picked questions once.
  // A few buckets at a time: a subject with many chapters would otherwise send dozens of queries at once.
  const sampleBucket = async (take: (typeof plan.takes)[number]) => {
    const match: Record<string, unknown> = { ...eligible, chapter: { $regex: new RegExp(`^${take.chapter.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } };
    if (take.level) match.difficulty = { $in: LEVEL_SPELLINGS[take.level] };
    const sampled = await Question.aggregate<{ _id: Types.ObjectId }>([
      { $match: match },
      { $project: { _id: 1 } },
      { $sample: { size: take.count } },
    ]).option({ allowDiskUse: true });
    return sampled.map((doc) => doc._id);
  };
  const picked: Types.ObjectId[][] = [];
  for (let from = 0; from < plan.takes.length; from += SAMPLE_CONCURRENCY) {
    picked.push(...(await Promise.all(plan.takes.slice(from, from + SAMPLE_CONCURRENCY).map(sampleBucket))));
  }
  const ids = picked.flat();
  const docs = ids.length ? await Question.find({ _id: { $in: ids } }).lean<Record<string, unknown>[]>() : [];

  // MCQs first, then numerical ones (a paper prints each kind as its own section); within a kind by chapter, level, then paper order.
  const levelRank = (doc: Record<string, unknown>) => LEVELS.indexOf(levelOf(doc.difficulty as string));
  const kindRank = (doc: Record<string, unknown>) => (doc.answerType === "Numerical" ? 1 : 0);
  const questions = docs.sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      order(String(a.chapter ?? "")) - order(String(b.chapter ?? "")) ||
      String(a.chapter ?? "").localeCompare(String(b.chapter ?? ""), undefined, { numeric: true }) ||
      levelRank(a) - levelRank(b) ||
      String(a.paperId ?? "").localeCompare(String(b.paperId ?? "")) ||
      Number(a.questionNumber ?? 0) - Number(b.questionNumber ?? 0)
  );

  return {
    questions,
    requested: plan.requested,
    found: questions.length,
    available,
    avoided,
    foundByLevel: plan.foundByLevel,
    requestedByLevel: plan.requestedByLevel,
  };
}
