import type { Session } from "@/lib/auth";
import { ENGAGEMENT, goalXpOf } from "@/lib/engagement/config";
import { levelForXp, levelProgress } from "@/lib/engagement/levels";
import { emptyStreak, markStreakDay, rollStreak, type StreakState } from "@/lib/engagement/streak";
import { istDate, istHour, istWeekKey } from "@/lib/engagement/time";
import DailyActivity, { type DailyActivityDoc } from "@/models/DailyActivity";
import StudentEngagement, { type StudentEngagementDoc } from "@/models/StudentEngagement";
import Tuition from "@/models/Tuition";
import XpEvent from "@/models/XpEvent";

// The award engine: the ONLY place XP is granted. Routes describe a learning
// action (kind, a deterministic key, base XP); the engine applies the per-tuition
// flag, the speed guard, the daily practice cap and the late-night guard, writes
// the ledger once per key, then updates the day, the level and the streak.
// Routes call it through safeAward (or the hooks in rules.ts), which never throw.

type Id = { toString(): string } | string;

export interface AwardStudent {
  _id: Id;
  tuitionId: Id;
  batchId?: Id | null;
}

export interface AwardInput {
  student: AwardStudent;
  kind: string;
  /** Deterministic, e.g. practice:<sid>:<qid>:first. The same key awards once. */
  key: string;
  /** Base XP before guards and caps. */
  xp: number;
  meta?: Record<string, unknown>;
  at?: Date;
  /** A practice answer: counts toward the daily cap and the speed guard. */
  practice?: boolean;
  /** Counts this IST date as a streak day if it is today (exam-day protection). */
  streakDate?: string;
  /** Practice counters for the day. */
  counts?: { question?: boolean; correct?: boolean; fixed?: boolean };
}

/** What the app shows in the progress header (GET /api/engagement/me and every `engagement` field). */
export interface MeSnapshot {
  enabled: true;
  xp: ReturnType<typeof levelProgress> & { total: number };
  today: { date: string; xp: number; goal: number; goalKey: string; goalMet: boolean; practiceXp: number; practiceCap: number };
  streak: { current: number; longest: number; freezes: number; maxFreezes: number; securedToday: boolean };
}

export type EngagementField =
  | { enabled: true; xpAwarded: number; duplicate: boolean; me: MeSnapshot }
  | { enabled: false };

/** The award target for a logged-in student (requireUser guarantees the tuition). */
export const studentOf = (session: Session): AwardStudent => ({ _id: session.user._id, tuitionId: session.tuitionId, batchId: session.user.batchId ?? null });

const str = (id: Id | null | undefined) => (id == null ? null : String(id));

export async function engagementEnabled(tuitionId: Id) {
  const t = await Tuition.findById(str(tuitionId)).select("engagement").lean<{ engagement?: { enabled?: boolean } }>();
  return t?.engagement?.enabled !== false;
}

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

/** The student's profile, created if missing and its streak rolled to `today`. */
export async function ensureEngagement(student: AwardStudent, today: string): Promise<StudentEngagementDoc> {
  const studentId = str(student._id);
  let eng: StudentEngagementDoc | null = null;
  try {
    eng = (await StudentEngagement.findOneAndUpdate(
      { studentId },
      { $setOnInsert: { studentId, tuitionId: str(student.tuitionId), batchId: str(student.batchId), streak: emptyStreak() } },
      { upsert: true, returnDocument: "after" }
    )) as StudentEngagementDoc;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e; // two first requests at once: the other one created it
    eng = (await StudentEngagement.findOne({ studentId })) as StudentEngagementDoc;
  }
  return rollTo(eng, today);
}

const streakOf = (eng: StudentEngagementDoc): StreakState => ({
  current: eng.streak?.current ?? 0,
  longest: eng.streak?.longest ?? 0,
  lastGoalDate: eng.streak?.lastGoalDate ?? null,
  freezes: eng.streak?.freezes ?? 0,
});

/**
 * Writes a streak change only if nobody changed the streak since we read it,
 * so two requests at once can't double-count a day or double-spend a freeze.
 * On a conflict it re-reads and tries again.
 */
async function updateStreak(eng: StudentEngagementDoc, change: (s: StreakState) => StreakState): Promise<StudentEngagementDoc> {
  let doc = eng;
  for (let tries = 0; tries < 3; tries++) {
    const before = streakOf(doc);
    const after = change(before);
    if (after === before) return doc;
    const updated = (await StudentEngagement.findOneAndUpdate(
      { _id: doc._id, "streak.lastGoalDate": before.lastGoalDate, "streak.current": before.current, "streak.freezes": before.freezes },
      { $set: { streak: after } },
      { returnDocument: "after" }
    )) as StudentEngagementDoc | null;
    if (updated) return updated;
    doc = (await StudentEngagement.findById(doc._id)) as StudentEngagementDoc;
  }
  return doc;
}

const rollTo = (eng: StudentEngagementDoc, today: string) => updateStreak(eng, (s) => rollStreak(s, today).state);

/** Speed guard: a fast answer (< minGapMs after the previous) beyond streakOfFast in a row earns 0. */
async function speedGuard(eng: StudentEngagementDoc, at: Date, xp: number): Promise<number> {
  const { minGapMs, streakOfFast } = ENGAGEMENT.speedGuard;
  const last = eng.lastAnswerAt;
  const fast = !!last && at.getTime() - last.getTime() < minGapMs && at.getTime() >= last.getTime();
  const fastRun = fast ? (eng.fastRun ?? 0) + 1 : 0;
  await StudentEngagement.updateOne({ _id: eng._id }, { $set: { lastAnswerAt: at, fastRun } });
  return fastRun > streakOfFast ? 0 : xp;
}

/** The snapshot the app shows, from the profile and today's row. */
export function snapshotOf(eng: StudentEngagementDoc, day: Pick<DailyActivityDoc, "xp" | "goalXp" | "goalMet" | "practiceXp"> | null, today: string): MeSnapshot {
  const total = Math.max(0, eng.totalXp ?? 0);
  const s = streakOf(eng);
  return {
    enabled: true,
    xp: { total, ...levelProgress(total) },
    today: {
      date: today,
      xp: day?.xp ?? 0,
      goal: day?.goalXp ?? goalXpOf(eng.goal),
      goalKey: eng.goal ?? ENGAGEMENT.defaultGoal,
      goalMet: day?.goalMet ?? false,
      practiceXp: day?.practiceXp ?? 0,
      practiceCap: ENGAGEMENT.caps.practicePerDay,
    },
    streak: { current: s.current, longest: s.longest, freezes: s.freezes, maxFreezes: ENGAGEMENT.streak.maxFreezes, securedToday: s.lastGoalDate === today },
  };
}

/** The current snapshot without awarding anything (or { enabled: false }). */
export async function engagementSnapshot(student: AwardStudent, at = new Date()): Promise<EngagementField> {
  if (!(await engagementEnabled(student.tuitionId))) return { enabled: false };
  const today = istDate(at);
  const eng = await ensureEngagement(student, today);
  const day = await DailyActivity.findOne({ studentId: str(student._id), date: today }).lean<DailyActivityDoc>();
  return { enabled: true, xpAwarded: 0, duplicate: false, me: snapshotOf(eng, day, today) };
}

/** Counts `day` as a streak day for the student (after the roll to the same day). */
async function markDay(eng: StudentEngagementDoc, day: string) {
  return updateStreak(eng, (s) => markStreakDay(s, day));
}

export async function award(input: AwardInput): Promise<EngagementField> {
  const { student } = input;
  if (!(await engagementEnabled(student.tuitionId))) return { enabled: false };
  const at = input.at ?? new Date();
  const today = istDate(at);
  const studentId = str(student._id);

  // A replay: answer with the current state, change nothing (not even the speed guard).
  if (await XpEvent.exists({ key: input.key })) return { ...(await engagementSnapshot(student, at)), duplicate: true } as EngagementField;

  let eng = await ensureEngagement(student, today);
  let xp = Math.max(0, Math.round(input.xp));
  if (input.practice) {
    xp = await speedGuard(eng, at, xp);
    const sofar = await DailyActivity.findOne({ studentId, date: today }).select("practiceXp").lean<{ practiceXp?: number }>();
    xp = Math.max(0, Math.min(xp, ENGAGEMENT.caps.practicePerDay - (sofar?.practiceXp ?? 0)));
  }
  const hour = istHour(at);
  const lateNight = hour >= ENGAGEMENT.lateNight.fromHour && hour < ENGAGEMENT.lateNight.toHour;

  try {
    await XpEvent.create({
      key: input.key, studentId, tuitionId: str(student.tuitionId), batchId: str(student.batchId),
      kind: input.kind, xp, date: today, weekKey: istWeekKey(at), league: !lateNight, practice: !!input.practice,
      meta: input.meta ?? {}, at,
    });
  } catch (e) {
    if (isDuplicateKey(e)) return { ...(await engagementSnapshot(student, at)), duplicate: true } as EngagementField;
    throw e;
  }

  const inc: Record<string, number> = { xp };
  if (input.practice) inc.practiceXp = xp;
  if (input.counts?.question) inc.questions = 1;
  if (input.counts?.correct) inc.correct = 1;
  if (input.counts?.fixed) inc.mistakesFixed = 1;
  const testDay = !!input.streakDate && input.streakDate === today;
  const dayUpdate = {
    $inc: inc,
    $setOnInsert: { tuitionId: str(student.tuitionId), batchId: str(student.batchId), goalXp: goalXpOf(eng.goal), firstAt: at },
    $set: { lastAt: at, ...(testDay ? { testDay: true } : {}) },
  };
  let day: DailyActivityDoc;
  try {
    day = (await DailyActivity.findOneAndUpdate({ studentId, date: today }, dayUpdate, { upsert: true, returnDocument: "after" })) as DailyActivityDoc;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e; // a concurrent first award of the day created the row
    day = (await DailyActivity.findOneAndUpdate({ studentId, date: today }, dayUpdate, { returnDocument: "after" })) as DailyActivityDoc;
  }

  if (xp > 0) {
    eng = (await StudentEngagement.findOneAndUpdate({ _id: eng._id }, { $inc: { totalXp: xp } }, { returnDocument: "after" })) as StudentEngagementDoc;
    const level = levelForXp(eng.totalXp);
    if (level > (eng.level ?? 1)) eng = (await StudentEngagement.findOneAndUpdate({ _id: eng._id }, { $max: { level } }, { returnDocument: "after" })) as StudentEngagementDoc;
  }

  // The goal counts once per day: only the request that flips goalMet marks the streak.
  if (!day.goalMet && day.xp >= day.goalXp) {
    const flipped = await DailyActivity.findOneAndUpdate({ _id: day._id, goalMet: false }, { $set: { goalMet: true } }, { returnDocument: "after" });
    if (flipped) {
      day = flipped as DailyActivityDoc;
      eng = await markDay(eng, today);
    }
  }
  // Exam-day protection: a test written today keeps the streak even below the goal.
  if (testDay) eng = await markDay(eng, today);

  return { enabled: true, xpAwarded: xp, duplicate: false, me: snapshotOf(eng, day, today) };
}

/**
 * The engine behind safeAward. Tests replace engine.award to check that a
 * failing engine never breaks answering, submitting or tests.
 */
export const engine = { award };

/** award() that never throws: a gamification failure is logged and answered with null. */
export async function safeAward(input: AwardInput | null | (() => Promise<AwardInput | null>)): Promise<EngagementField | null> {
  try {
    const resolved = typeof input === "function" ? await input() : input;
    if (!resolved) return null;
    return await engine.award(resolved);
  } catch (error) {
    console.error("[engagement] award failed", error);
    return null;
  }
}
