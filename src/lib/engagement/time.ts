// IST calendar helpers. All streak, goal and league days are India days,
// the same offset as todayInIndia() in lib/teaching.ts:
// istDate() === todayInIndia().date.

const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86_400_000;

const shifted = (d: Date) => new Date(d.getTime() + IST_MS);

/** The IST calendar date, 'YYYY-MM-DD'. */
export const istDate = (d = new Date()) => shifted(d).toISOString().slice(0, 10);

/** The IST hour, 0–23. */
export const istHour = (d = new Date()) => shifted(d).getUTCHours();

/** The ISO week of the IST date, e.g. '2026-W46' (weeks start Monday 00:00 IST). */
export function istWeekKey(d = new Date()) {
  const t = shifted(d);
  const day = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - day + 3); // the Thursday of this week decides its year
  const year = t.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Whole days from date a to date b ('YYYY-MM-DD'); negative when b is earlier. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The date n days after `date` ('YYYY-MM-DD'). */
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
