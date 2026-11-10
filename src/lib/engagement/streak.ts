import { ENGAGEMENT } from "@/lib/engagement/config";
import { addDays, daysBetween } from "@/lib/engagement/time";

// The streak, as pure functions over its stored state. There's no cron: the
// streak "rolls" lazily whenever the student's profile is next touched.
//
// A streak day = the daily goal met by IST midnight, or an assigned test written
// that day (exam-day protection). A missed day spends a freeze if one is held;
// otherwise the streak resets to 0. The longest streak is kept forever.

export interface StreakState {
  current: number;
  longest: number;
  /** The last day the streak covers (a goal day or a frozen day); null when there's no running streak. */
  lastGoalDate: string | null;
  freezes: number;
}

export const emptyStreak = (): StreakState => ({ current: 0, longest: 0, lastGoalDate: null, freezes: 0 });

/**
 * Brings the streak up to `today`: missed days since lastGoalDate are covered
 * by freezes if there are enough, else the streak breaks. Returns the same
 * object when nothing changes.
 */
export function rollStreak(state: StreakState, today: string): { state: StreakState; frozen: number; broke: boolean } {
  if (!state.lastGoalDate) return { state, frozen: 0, broke: false };
  const gap = daysBetween(state.lastGoalDate, today);
  if (gap <= 1) return { state, frozen: 0, broke: false };
  const missed = gap - 1;
  if (missed <= state.freezes) {
    // Frozen days keep the streak alive but don't add to it.
    return { state: { ...state, freezes: state.freezes - missed, lastGoalDate: addDays(today, -1) }, frozen: missed, broke: false };
  }
  return { state: { ...state, current: 0, lastGoalDate: null }, frozen: 0, broke: true };
}

/**
 * Counts `day` as a streak day (call after rollStreak to the same day). Counting
 * the same day twice changes nothing. Every `freezeEvery` consecutive days earn
 * a freeze, up to `maxFreezes`.
 */
export function markStreakDay(state: StreakState, day: string): StreakState {
  if (state.lastGoalDate === day) return state;
  if (state.lastGoalDate && daysBetween(state.lastGoalDate, day) < 0) return state; // never move backwards
  const continues = !!state.lastGoalDate && daysBetween(state.lastGoalDate, day) === 1;
  const current = continues ? state.current + 1 : 1;
  const { freezeEvery, maxFreezes } = ENGAGEMENT.streak;
  const freezes = current % freezeEvery === 0 ? Math.min(maxFreezes, state.freezes + 1) : state.freezes;
  return { current, longest: Math.max(state.longest, current), lastGoalDate: day, freezes };
}
