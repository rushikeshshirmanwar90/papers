// Self-assessment: choosing the questions and reading the result. Pure
// functions (no database), so they can be tested on their own
// (tests/self-assessment.test.ts). lib/self-assessment.ts feeds them.
//
// Choosing questions, for a student-made test over some chapters and topics:
//
// 1. The difficulty split comes from the mix: Balanced 30/50/20 (easy/medium/
//    hard), Challenge 15/40/45, and Smart, which follows the student's past
//    accuracy in those topics (struggling → more easy; doing well → more hard).
// 2. The questions are shared out fairly (Sainte-Laguë) over the chapters
//    picked, then over each chapter's topics, never asking a topic for more
//    than it has; ties go at random. Smart gives weak topics more.
// 3. Each topic's share is filled difficulty by difficulty, always taking the
//    level furthest behind its target that the topic still has. When the bank
//    runs short of a level (Biology has few hard ones), the nearest other
//    level fills in, so the test still has the size asked for.
// 4. Within a topic and level, questions never answered come first, then ones
//    answered wrongly before, then ones answered right; random within each.
// 5. The paper runs easy → medium → hard, with topics interleaved in each band.

export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MIXES = ["smart", "balanced", "challenge", "retake"] as const;
export type Mix = (typeof MIXES)[number];

export type Split = Record<Difficulty, number>;

/** Shares of easy, medium and hard for the fixed mixes. */
export const MIX_SPLIT: Record<Exclude<Mix, "smart">, Split> = {
  balanced: { Easy: 0.3, Medium: 0.5, Hard: 0.2 },
  challenge: { Easy: 0.15, Medium: 0.4, Hard: 0.45 },
  // The app's "Retake weak topics": the weak topics again, leaning hard.
  retake: { Easy: 0.3, Medium: 0.3, Hard: 0.4 },
};

/** Smart mix: the split for the student's accuracy so far in the topics picked. */
export const SMART_SPLIT = {
  struggling: { Easy: 0.5, Medium: 0.4, Hard: 0.1 },
  steady: { Easy: 0.3, Medium: 0.5, Hard: 0.2 },
  confident: { Easy: 0.2, Medium: 0.4, Hard: 0.4 },
} as const satisfies Record<string, Split>;

/** Answers needed in the topics picked before Smart goes by the student's accuracy. */
export const SMART_MIN_ANSWERS = 5;

/** Strength (correct of all asked) from which a topic counts as strong, and below which weak. */
export const STRONG_FROM = 70;
export const WEAK_BELOW = 40;

/** How much more of the test a topic gets in the Smart mix, by how the student has done in it. */
export const SMART_WEIGHT = { weak: 2, average: 1.5, strong: 0.75, "not-enough": 1 } as const;

export type Level = keyof typeof SMART_WEIGHT;

/** The bank's difficulty as one of the three levels (anything else counts as medium). */
export function difficultyOf(value: unknown): Difficulty {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "easy" ? "Easy" : v === "hard" ? "Hard" : "Medium";
}

/** "strong" | "average" | "weak", from the share right (0–100). */
export const levelFromPercent = (percent: number): Exclude<Level, "not-enough"> =>
  percent >= STRONG_FROM ? "strong" : percent < WEAK_BELOW ? "weak" : "average";

/** The difficulty split for a mix; Smart reads the student's accuracy (null: no history). */
export function splitFor(mix: Mix, history: { answered: number; correct: number }): { split: Split; basis: SmartBasis } {
  if (mix !== "smart") return { split: MIX_SPLIT[mix], basis: { kind: "fixed", accuracy: null, answered: history.answered } };
  if (history.answered < SMART_MIN_ANSWERS) return { split: SMART_SPLIT.steady, basis: { kind: "no-history", accuracy: null, answered: history.answered } };
  const accuracy = Math.round((history.correct / history.answered) * 100);
  const kind = accuracy < WEAK_BELOW ? "struggling" : accuracy >= STRONG_FROM ? "confident" : "steady";
  return { split: SMART_SPLIT[kind], basis: { kind, accuracy, answered: history.answered } };
}

export interface SmartBasis {
  /** fixed: Balanced or Challenge; no-history: Smart without enough answers yet. */
  kind: "fixed" | "no-history" | "struggling" | "steady" | "confident";
  accuracy: number | null;
  answered: number;
}

/**
 * Shares `total` seats over items by weight (Sainte-Laguë: each seat goes to
 * the item with the highest weight / (2·seats + 1)), never giving an item more
 * than its cap. Ties go to the item listed first. Fewer seats come out when the
 * caps add up to less than `total`.
 */
export function shareOut<K>(total: number, items: { key: K; weight: number; cap: number }[]): Map<K, number> {
  const seats = new Map<K, number>(items.map((i) => [i.key, 0]));
  for (let n = 0; n < total; n++) {
    let best: { key: K; score: number } | null = null;
    for (const item of items) {
      const have = seats.get(item.key)!;
      if (have >= item.cap || item.weight <= 0) continue;
      const score = item.weight / (2 * have + 1);
      if (!best || score > best.score) best = { key: item.key, score };
    }
    if (!best) break;
    seats.set(best.key, seats.get(best.key)! + 1);
  }
  return seats;
}

/** One question the test could use. `tier`: 0 never answered, 1 answered wrongly (or shown and skipped), 2 answered right. */
export interface PoolQuestion {
  id: string;
  /** The topic it belongs to (see Unit). */
  unit: string;
  difficulty: Difficulty;
  tier: 0 | 1 | 2;
}

/** How many questions a topic has at one level, and how many of them the student has never seen. */
export interface Cell {
  unit: string;
  difficulty: Difficulty;
  total: number;
  fresh: number;
}

/** A topic (or a chapter without named topics) the student picked. */
export interface Unit {
  key: string;
  /** How the student has done here so far, for the Smart mix. */
  level: Level;
  /** The chapter it's in: questions are shared over chapters first, then their topics. Defaults to the topic itself. */
  group?: string;
}

/** Questions to take per topic and level. */
export type Allocation = Map<string, Split>;

export interface Plan {
  /** How many questions the test gets (less than asked when the bank has fewer). */
  count: number;
  requested: number;
  byDifficulty: Split;
  /** The target split, as shares adding up to 1. */
  split: Split;
  /** Questions per topic, in the order the topics were given. */
  byUnit: { key: string; count: number }[];
  /** How many of the questions the student has never answered. */
  fresh: number;
  available: { total: number; fresh: number } & Split;
}

/** A seeded random number generator (mulberry32), so a plan can be made again the same way. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Levels in the order to try when the one wanted has run out: the nearest first. */
const FALLBACK: Record<Difficulty, Difficulty[]> = { Easy: ["Medium", "Hard"], Medium: ["Easy", "Hard"], Hard: ["Medium", "Easy"] };

const zero = (): Split => ({ Easy: 0, Medium: 0, Hard: 0 });

/**
 * Steps 1–3 (see the top of this file), from counts alone: how many questions
 * to take from each topic at each level. Ties are broken at random, so with
 * more topics than questions no chapter is favoured for coming first; the same
 * `random` (seed) gives the same plan. `smart` gives weak topics more.
 */
export function allocate({
  cells,
  units,
  count,
  split,
  smart,
  random,
}: {
  cells: Cell[];
  units: Unit[];
  count: number;
  split: Split;
  smart: boolean;
  random: () => number;
}): { allocation: Allocation; plan: Plan } {
  const have = new Map<string, Split>(units.map((u) => [u.key, zero()]));
  const fresh = new Map<string, Split>(units.map((u) => [u.key, zero()]));
  for (const c of cells) {
    if (!have.has(c.unit)) continue;
    have.get(c.unit)![c.difficulty] += c.total;
    fresh.get(c.unit)![c.difficulty] += Math.min(c.total, c.fresh);
  }
  const sizeOf = (key: string) => DIFFICULTIES.reduce((n, d) => n + have.get(key)![d], 0);
  const sumOver = (m: Map<string, Split>, d?: Difficulty) => [...m.values()].reduce((n, s) => n + (d ? s[d] : s.Easy + s.Medium + s.Hard), 0);
  const available = { total: sumOver(have), fresh: sumOver(fresh), Easy: sumOver(have, "Easy"), Medium: sumOver(have, "Medium"), Hard: sumOver(have, "Hard") };
  const size = Math.min(count, available.total);
  const weightOf = (u: Unit) => (smart ? SMART_WEIGHT[u.level] : 1);

  // 1. Each chapter's share, then each topic's share of its chapter.
  const groups = new Map<string, Unit[]>();
  for (const u of shuffled(units, random)) groups.set(u.group ?? u.key, [...(groups.get(u.group ?? u.key) ?? []), u]);
  const perGroup = shareOut(
    size,
    [...groups.entries()].map(([key, list]) => ({
      key,
      weight: list.reduce((n, u) => n + weightOf(u), 0) / list.length,
      cap: list.reduce((n, u) => n + sizeOf(u.key), 0),
    }))
  );
  const perUnit = new Map<string, number>();
  for (const [key, list] of groups) {
    const share = shareOut(perGroup.get(key) ?? 0, list.map((u) => ({ key: u.key, weight: weightOf(u), cap: sizeOf(u.key) })));
    for (const [k, n] of share) perUnit.set(k, n);
  }

  // 2. The target per level for the whole test.
  const target = shareOut(size, DIFFICULTIES.map((d) => ({ key: d, weight: split[d], cap: size })));

  // 3. Fill each topic's share level by level: the level furthest behind its
  // target first; when the topic has none of that level left, the nearest one.
  // Seat by seat across topics (round robin), so no topic takes all of a scarce
  // level; topics with fewer levels to choose from go first in each round.
  const allocation: Allocation = new Map(units.map((u) => [u.key, zero()]));
  const used = zero();
  const left = (key: string, d: Difficulty) => have.get(key)![d] - allocation.get(key)![d];
  const levelsOf = (key: string) => DIFFICULTIES.filter((d) => have.get(key)![d] > 0).length;
  const order = [...groups.values()].flat().sort((a, b) => levelsOf(a.key) - levelsOf(b.key));
  const filled = new Map<string, number>(units.map((u) => [u.key, 0]));
  let progress = true;
  while (progress) {
    progress = false;
    for (const u of order) {
      if (filled.get(u.key)! >= (perUnit.get(u.key) ?? 0)) continue;
      const wanted = [...DIFFICULTIES].sort((a, b) => target.get(b)! - used[b] - (target.get(a)! - used[a]) || DIFFICULTIES.indexOf(a) - DIFFICULTIES.indexOf(b))[0];
      const tries = [wanted, ...FALLBACK[wanted]];
      const level = tries.find((d) => left(u.key, d) > 0 && target.get(d)! - used[d] > 0) ?? tries.find((d) => left(u.key, d) > 0);
      if (!level) continue;
      allocation.get(u.key)![level] += 1;
      used[level] += 1;
      filled.set(u.key, filled.get(u.key)! + 1);
      progress = true;
    }
  }

  const total = DIFFICULTIES.reduce((n, d) => n + split[d], 0) || 1;
  return {
    allocation,
    plan: {
      count: DIFFICULTIES.reduce((n, d) => n + used[d], 0),
      requested: count,
      byDifficulty: used,
      split: { Easy: split.Easy / total, Medium: split.Medium / total, Hard: split.Hard / total },
      byUnit: units.map((u) => ({ key: u.key, count: filled.get(u.key)! })),
      // New questions are taken first in each topic and level, so this many of them are new.
      fresh: units.reduce((n, u) => n + DIFFICULTIES.reduce((m, d) => m + Math.min(allocation.get(u.key)![d], fresh.get(u.key)![d]), 0), 0),
      available,
    },
  };
}

/** Counts per topic and level from a list of questions. */
export function cellsOf(pool: PoolQuestion[]): Cell[] {
  const cells = new Map<string, Cell>();
  for (const q of pool) {
    const key = `${q.unit}#${q.difficulty}`;
    const c = cells.get(key) ?? { unit: q.unit, difficulty: q.difficulty, total: 0, fresh: 0 };
    c.total += 1;
    if (q.tier === 0) c.fresh += 1;
    cells.set(key, c);
  }
  return [...cells.values()];
}

/**
 * Steps 4–5: the questions for an allocation, from the pool (only the topics
 * and levels used need to be in it). Never answered first, then answered
 * wrongly, then answered right; random within each. In paper order: easy →
 * medium → hard, topics taking turns within each band.
 */
export function chooseQuestions(pool: PoolQuestion[], allocation: Allocation, random: () => number): PoolQuestion[] {
  const bands: Record<Difficulty, PoolQuestion[][]> = { Easy: [], Medium: [], Hard: [] };
  for (const [unit, split] of allocation) {
    for (const d of DIFFICULTIES) {
      if (!split[d]) continue;
      const here = pool.filter((q) => q.unit === unit && q.difficulty === d);
      const byTier = [0, 1, 2].flatMap((tier) => shuffled(here.filter((q) => q.tier === tier), random));
      bands[d].push(byTier.slice(0, split[d]));
    }
  }
  const questions: PoolQuestion[] = [];
  for (const d of DIFFICULTIES) {
    const lists = shuffled(bands[d], random);
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) questions.push(l[i]);
  }
  return questions;
}

/** Allocates and chooses in one go, from a full pool. */
export function pickQuestions(input: { pool: PoolQuestion[]; units: Unit[]; count: number; split: Split; smart: boolean; random: () => number }): { questions: PoolQuestion[]; plan: Plan } {
  const { allocation, plan } = allocate({ ...input, cells: cellsOf(input.pool) });
  const questions = chooseQuestions(input.pool, allocation, input.random);
  return { questions, plan: { ...plan, count: questions.length, fresh: questions.filter((q) => q.tier === 0).length } };
}

// ─── Reading the result ────────────────────────────────────────────────────

export interface ReportQuestion {
  standard: string;
  chapter: string;
  topic: string;
  difficulty: string;
}

export interface ReportAnswer {
  index: number;
  selected: string | null;
  correct: boolean | null;
}

/** Right, wrong and skipped for one part of the test, and what they say. */
export interface Tally {
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Correct out of every question asked here (skipped ones count as not known), 0–100. */
  strength: number;
  /** 100 − strength: the share of this part the student didn't get. */
  weakness: number;
  /** Correct out of the ones answered; null when none were. */
  accuracy: number | null;
  level: Exclude<Level, "not-enough">;
}

export interface TopicReport extends Tally {
  standard: string;
  chapter: string;
  /** "" for a chapter without named topics. */
  topic: string;
  /** The share of all the test's lost questions (wrong + skipped) that are in this topic, 0–100. */
  shareOfMistakes: number;
  /** Question numbers (from 1) answered wrongly, and skipped. */
  wrongNumbers: number[];
  skippedNumbers: number[];
  /** Only one question here: read the level with care. */
  fewQuestions: boolean;
}

export interface Report {
  overall: Tally;
  /** Weakest first. */
  topics: TopicReport[];
  chapters: (Tally & { standard: string; chapter: string; topics: number })[];
  difficulty: (Tally & { difficulty: Difficulty })[];
  strongTopics: number;
  weakTopics: number;
  /** One line on where the marks went, e.g. "Most of your mistakes were in Projectile Motion (60%)." */
  headline: string;
  /** What to do next, most useful first. */
  advice: string[];
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function tally(rows: { correct: boolean | null; selected: string | null }[]): Tally {
  const total = rows.length;
  const correct = rows.filter((r) => r.correct === true).length;
  const skipped = rows.filter((r) => r.selected === null || r.correct === null).length;
  const wrong = total - correct - skipped;
  const strength = pct(correct, total);
  return {
    total,
    correct,
    wrong,
    skipped,
    strength,
    weakness: total ? 100 - strength : 0,
    accuracy: correct + wrong ? pct(correct, correct + wrong) : null,
    level: levelFromPercent(strength),
  };
}

const low = (s: string) => s.trim().toLowerCase();
const topicName = (t: { chapter: string; topic: string }) => t.topic || t.chapter;

/**
 * The result, topic by topic: how much of each the student got (strength %)
 * and missed (weakness %), which topics are strong or weak, where the lost
 * questions came from, and by difficulty. Answers must be marked already.
 */
export function buildReport(questions: ReportQuestion[], answers: ReportAnswer[]): Report {
  const byIndex = new Map(answers.map((a) => [a.index, a]));
  const rows = questions.map((q, index) => {
    const a = byIndex.get(index);
    return { ...q, index, selected: a?.selected ?? null, correct: a?.selected == null ? null : a.correct ?? null };
  });
  const overall = tally(rows);
  const lost = overall.wrong + overall.skipped;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.standard}|${low(r.chapter)}|${low(r.topic)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const topics: TopicReport[] = [...groups.values()].map((list) => {
    const t = tally(list);
    return {
      standard: list[0].standard,
      chapter: list[0].chapter,
      topic: list[0].topic,
      ...t,
      shareOfMistakes: pct(t.wrong + t.skipped, lost),
      wrongNumbers: list.filter((r) => r.correct === false).map((r) => r.index + 1),
      skippedNumbers: list.filter((r) => r.correct === null).map((r) => r.index + 1),
      fewQuestions: t.total < 2,
    };
  });
  // Weakest first; among equals, the one with more questions lost.
  topics.sort((a, b) => a.strength - b.strength || b.wrong + b.skipped - (a.wrong + a.skipped) || b.total - a.total || topicName(a).localeCompare(topicName(b)));

  const chapterGroups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.standard}|${low(r.chapter)}`;
    chapterGroups.set(key, [...(chapterGroups.get(key) ?? []), r]);
  }
  const chapters = [...chapterGroups.values()]
    .map((list) => ({
      standard: list[0].standard,
      chapter: list[0].chapter,
      topics: new Set(list.map((r) => low(r.topic))).size,
      ...tally(list),
    }))
    .sort((a, b) => a.strength - b.strength || a.chapter.localeCompare(b.chapter));

  const difficulty = DIFFICULTIES.map((d) => ({ difficulty: d, ...tally(rows.filter((r) => difficultyOf(r.difficulty) === d)) })).filter((d) => d.total > 0);

  const weak = topics.filter((t) => t.level === "weak");
  const strong = topics.filter((t) => t.level === "strong");
  return {
    overall,
    topics,
    chapters,
    difficulty,
    strongTopics: strong.length,
    weakTopics: weak.length,
    headline: headlineOf(overall, topics, lost),
    advice: adviceFor(overall, topics, difficulty),
  };
}

function headlineOf(overall: Tally, topics: TopicReport[], lost: number): string {
  if (!overall.total) return "This test had no questions.";
  if (!lost) return "Every question right. Well done!";
  if (overall.correct + overall.wrong === 0) return "No questions were answered.";
  const worst = [...topics].sort((a, b) => b.shareOfMistakes - a.shareOfMistakes)[0];
  if (topics.length > 1 && worst && worst.shareOfMistakes >= 40) {
    return `Most of the marks you lost were in ${topicName(worst)} (${worst.shareOfMistakes}% of them).`;
  }
  return `You got ${overall.correct} of ${overall.total} right: ${overall.strength}% of this test.`;
}

function adviceFor(overall: Tally, topics: TopicReport[], difficulty: Report["difficulty"]): string[] {
  const advice: string[] = [];
  const weak = topics.filter((t) => t.level === "weak" && !t.fewQuestions);
  if (weak.length) {
    const names = weak.slice(0, 3).map(topicName);
    advice.push(`Revise ${listOf(names)}${weak.length > 3 ? ` and ${weak.length - 3} more` : ""}, then practise their past-year questions.`);
  }
  const easy = difficulty.find((d) => d.difficulty === "Easy");
  const hard = difficulty.find((d) => d.difficulty === "Hard");
  if (easy && easy.total >= 2 && easy.strength < 60) advice.push("Several easy questions went wrong: go back over the basics and formulas before harder ones.");
  else if (hard && hard.total >= 2 && hard.strength < 40 && overall.strength >= 50) advice.push("Your basics are fine; hard questions are where marks go. Practise multi-step problems.");
  if (overall.total && overall.skipped / overall.total >= 0.25) advice.push(`You skipped ${overall.skipped} question${overall.skipped === 1 ? "" : "s"}. Try every question you can narrow down to two options.`);
  if (overall.correct + overall.wrong >= 4 && overall.accuracy !== null && overall.accuracy < 50) advice.push("Under half of your answers were right: slow down and check each step before choosing.");
  if (!advice.length && overall.strength >= STRONG_FROM) advice.push("Strong result. Try a Challenge test on these topics next.");
  if (!advice.length) advice.push("Retry the questions you got wrong after reading their solutions.");
  return advice;
}

const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
