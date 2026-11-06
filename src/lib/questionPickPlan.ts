// Planning an automatic pick: how many questions to take from each chapter
// and level. Pure arithmetic with no imports, so it can be tested without a
// database; lib/questionPick.ts draws the questions the plan asks for.

export const LEVELS = ["Easy", "Mid", "Hard"] as const;
export type Level = (typeof LEVELS)[number];
export type Mix = Record<Level, number>;

/** Most questions one pick may ask for (a PDF holds at most this many). */
export const MAX_PICK = 300;

/** Previous picks to leave out. */
export const MAX_EXCLUDED = 1000;

/** Uploads store the middle level as "Medium"; the apps say "Mid". */
const LEVEL_NAMES: Record<string, Level> = { Easy: "Easy", Mid: "Mid", Medium: "Mid", Hard: "Hard" };
export const LEVEL_SPELLINGS: Record<Level, string[]> = { Easy: ["Easy"], Mid: ["Mid", "Medium"], Hard: ["Hard"] };

export const levelOf = (difficulty: string | null | undefined): Level => LEVEL_NAMES[difficulty ?? ""] ?? "Mid";

// ─── Planning: how many from each chapter and level ─────────────────────────

/** Shares `quota` out one at a time between the buckets, none past its capacity. */
export function distribute(quota: number, capacities: readonly number[]): number[] {
  const shares = capacities.map(() => 0);
  let left = Math.min(quota, capacities.reduce((sum, capacity) => sum + capacity, 0));
  while (left > 0) {
    for (let i = 0; i < capacities.length && left > 0; i++) {
      if (shares[i] < capacities[i]) {
        shares[i]++;
        left--;
      }
    }
  }
  return shares;
}

export interface ChapterCapacity {
  chapter: string;
  /** Eligible questions of the chapter, by level. */
  levels: Record<Level, number>;
}

/** What to draw: `count` of any level, or a number of each level. */
export type Quota = { kind: "any"; count: number } | { kind: "mix"; mix: Mix };

export interface Take {
  chapter: string;
  /** null: any level. */
  level: Level | null;
  count: number;
}

export interface Plan {
  takes: Take[];
  requested: number;
  found: number;
  /** Per level when a mix was asked for. */
  foundByLevel: Mix;
  requestedByLevel: Mix | null;
}

export const zeroMix = (): Mix => ({ Easy: 0, Mid: 0, Hard: 0 });

export function planPick(chapters: readonly ChapterCapacity[], quota: Quota): Plan {
  const takes: Take[] = [];
  const foundByLevel = zeroMix();
  if (quota.kind === "any") {
    const caps = chapters.map((c) => LEVELS.reduce((sum, level) => sum + c.levels[level], 0));
    distribute(quota.count, caps).forEach((count, i) => {
      if (count) takes.push({ chapter: chapters[i].chapter, level: null, count });
    });
    const found = takes.reduce((sum, take) => sum + take.count, 0);
    return { takes, requested: quota.count, found, foundByLevel, requestedByLevel: null };
  }
  for (const level of LEVELS) {
    distribute(quota.mix[level], chapters.map((c) => c.levels[level])).forEach((count, i) => {
      if (!count) return;
      takes.push({ chapter: chapters[i].chapter, level, count });
      foundByLevel[level] += count;
    });
  }
  const requested = LEVELS.reduce((sum, level) => sum + quota.mix[level], 0);
  return { takes, requested, found: LEVELS.reduce((sum, level) => sum + foundByLevel[level], 0), foundByLevel, requestedByLevel: { ...quota.mix } };
}
