// Every tunable number of the engagement system (XP, goals, streaks), in one
// place. Logic lives in the other files of this folder; the app only shows
// what the server computes.

export const ENGAGEMENT = {
  xp: {
    /** First try at a practice question, right: this × the difficulty multiplier. */
    practiceCorrect: 10,
    /** First try, wrong: effort credit. */
    practiceWrong: 2,
    difficulty: { Easy: 1, Medium: 1.5, Hard: 2 } as Record<string, number>,
    /** A question whose last answer was wrong, now right: once per question per IST day. */
    mistakeFixed: 15,
    /** Self-assessment: per attempted question (skipped ones earn nothing), at most selfMax. */
    selfPerQuestion: 3,
    selfMax: 120,
    /** An assigned test finished: participation only, never based on marks. */
    testSubmitted: 80,
  },
  caps: {
    /** Practice-answer XP stops here each IST day; other sources still count. */
    practicePerDay: 400,
  },
  speedGuard: {
    /** An answer this soon after the previous one is "fast"… */
    minGapMs: 4000,
    /** …and fast answers beyond this many in a row earn 0 XP (still marked and saved). */
    streakOfFast: 3,
  },
  /** IST hours [from, to): XP still counts, but not toward the weekly league. */
  lateNight: { fromHour: 0, toHour: 5 },
  goals: { chill: 50, regular: 100, serious: 200, beast: 300 },
  defaultGoal: "regular" as const,
  streak: {
    /** One freeze earned for every this many consecutive streak days… */
    freezeEvery: 7,
    /** …holding at most this many. */
    maxFreezes: 2,
  },
} as const;

export type GoalKey = keyof typeof ENGAGEMENT.goals;

export const goalXpOf = (goal: string | null | undefined) =>
  ENGAGEMENT.goals[(goal ?? ENGAGEMENT.defaultGoal) as GoalKey] ?? ENGAGEMENT.goals[ENGAGEMENT.defaultGoal];

/** The difficulty multiplier; an unknown difficulty counts as Easy. */
export const difficultyOf = (difficulty: string | null | undefined) => ENGAGEMENT.xp.difficulty[difficulty ?? ""] ?? 1;
