// Engagement Phase 0: the pure rules — IST days and weeks, the level formula
// and the streak (freezes). No database.
// Run with: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ENGAGEMENT, goalXpOf } from "@/lib/engagement/config";
import { levelForXp, levelProgress, xpForLevel } from "@/lib/engagement/levels";
import { emptyStreak, markStreakDay, rollStreak, type StreakState } from "@/lib/engagement/streak";
import { addDays, daysBetween, istDate, istHour, istWeekKey } from "@/lib/engagement/time";

const utc = (iso: string) => new Date(iso);

describe("IST time helpers", () => {
  test("istDate matches todayInIndia", async () => {
    // lib/teaching loads the db module, which needs a URI to be set (never connected here).
    process.env.MONGODB_URI ??= "mongodb://127.0.0.1:9/unused";
    const { todayInIndia } = await import("@/lib/teaching");
    assert.equal(istDate(), todayInIndia().date);
  });

  test("the IST day changes at 18:30 UTC (midnight IST)", () => {
    assert.equal(istDate(utc("2026-11-09T18:29:59.999Z")), "2026-11-09");
    assert.equal(istDate(utc("2026-11-09T18:30:00.000Z")), "2026-11-10");
    assert.equal(istDate(utc("2026-11-09T00:00:00Z")), "2026-11-09"); // 05:30 IST
    assert.equal(istDate(utc("2026-11-08T23:00:00Z")), "2026-11-09"); // 04:30 IST next day
  });

  test("istHour around midnight and the 05:00 late-night edge", () => {
    assert.equal(istHour(utc("2026-11-09T18:29:59Z")), 23);
    assert.equal(istHour(utc("2026-11-09T18:30:00Z")), 0);
    assert.equal(istHour(utc("2026-11-09T23:29:59Z")), 4);
    assert.equal(istHour(utc("2026-11-09T23:30:00Z")), 5);
  });

  test("the IST week starts Monday 00:00 IST", () => {
    // Monday 2026-11-09 00:00 IST = 2026-11-08 18:30 UTC.
    assert.equal(istWeekKey(utc("2026-11-08T18:29:59Z")), "2026-W45"); // Sunday 23:59:59 IST
    assert.equal(istWeekKey(utc("2026-11-08T18:30:00Z")), "2026-W46");
    assert.equal(istWeekKey(utc("2026-11-15T18:29:59Z")), "2026-W46"); // Sunday night IST
    assert.equal(istWeekKey(utc("2026-11-15T18:30:00Z")), "2026-W47");
  });

  test("ISO weeks across the new year", () => {
    assert.equal(istWeekKey(utc("2021-01-01T06:00:00Z")), "2020-W53");
    assert.equal(istWeekKey(utc("2027-01-01T06:00:00Z")), "2026-W53");
    assert.equal(istWeekKey(utc("2027-01-04T06:00:00Z")), "2027-W01");
    assert.equal(istWeekKey(utc("2026-01-01T06:00:00Z")), "2026-W01");
    // 31 Dec 2026 18:30 UTC is already 1 Jan 2027 in India.
    assert.equal(istDate(utc("2026-12-31T18:30:00Z")), "2027-01-01");
  });

  test("daysBetween and addDays", () => {
    assert.equal(daysBetween("2026-11-09", "2026-11-10"), 1);
    assert.equal(daysBetween("2026-11-10", "2026-11-09"), -1);
    assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
    assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2); // leap year
    assert.equal(addDays("2026-11-09", -1), "2026-11-08");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});

describe("levels: 50 · L · (L − 1)", () => {
  test("known totals", () => {
    assert.deepEqual([1, 2, 5, 10, 15, 20, 40].map(xpForLevel), [0, 100, 1000, 4500, 10500, 19000, 78000]);
  });

  test("levelForXp is the exact inverse at every boundary", () => {
    for (let level = 1; level <= 200; level++) {
      assert.equal(levelForXp(xpForLevel(level)), level, `start of L${level}`);
      if (level > 1) assert.equal(levelForXp(xpForLevel(level) - 1), level - 1, `just below L${level}`);
    }
    assert.equal(levelForXp(-50), 1);
    assert.equal(levelForXp(0), 1);
  });

  test("progress to the next level", () => {
    assert.deepEqual(levelProgress(150), { level: 2, levelStartXp: 100, nextLevelXp: 300, intoLevel: 50, toNext: 150, progress: 0.25 });
    assert.equal(levelProgress(0).progress, 0);
  });
});

describe("goals", () => {
  test("Regular (100) is everyone's default", () => {
    assert.equal(ENGAGEMENT.defaultGoal, "regular");
    assert.equal(goalXpOf(undefined), 100);
    assert.equal(goalXpOf("beast"), 300);
    assert.equal(goalXpOf("nonsense"), 100);
  });
});

describe("streak", () => {
  const run = (days: string[], start: StreakState = emptyStreak()) =>
    days.reduce((s, day) => markStreakDay(rollStreak(s, day).state, day), start);

  test("consecutive goal days add up; the same day twice counts once", () => {
    let s = markStreakDay(emptyStreak(), "2026-11-09");
    assert.deepEqual(s, { current: 1, longest: 1, lastGoalDate: "2026-11-09", freezes: 0 });
    assert.equal(markStreakDay(s, "2026-11-09"), s);
    s = run(["2026-11-10"], s);
    assert.equal(s.current, 2);
  });

  test("rolling within a day or to the next day changes nothing", () => {
    const s = markStreakDay(emptyStreak(), "2026-11-09");
    assert.equal(rollStreak(s, "2026-11-09").state, s);
    assert.equal(rollStreak(s, "2026-11-10").state, s);
  });

  test("a freeze every 7 days, at most 2", () => {
    const days = Array.from({ length: 21 }, (_, i) => addDays("2026-11-01", i));
    assert.equal(run(days.slice(0, 6)).freezes, 0);
    assert.equal(run(days.slice(0, 7)).freezes, 1);
    assert.equal(run(days.slice(0, 14)).freezes, 2);
    assert.equal(run(days).freezes, 2);
    assert.equal(run(days).current, 21);
  });

  test("a missed day spends a freeze and the streak carries on", () => {
    const week = run(Array.from({ length: 7 }, (_, i) => addDays("2026-11-01", i))); // ends 2026-11-07, 1 freeze
    const rolled = rollStreak(week, "2026-11-09"); // 2026-11-08 missed
    assert.equal(rolled.frozen, 1);
    assert.equal(rolled.broke, false);
    assert.deepEqual(rolled.state, { current: 7, longest: 7, lastGoalDate: "2026-11-08", freezes: 0 });
    assert.equal(markStreakDay(rolled.state, "2026-11-09").current, 8);
  });

  test("more missed days than freezes breaks the streak but keeps the longest", () => {
    const week = run(Array.from({ length: 7 }, (_, i) => addDays("2026-11-01", i))); // 1 freeze
    const rolled = rollStreak(week, "2026-11-10"); // two days missed
    assert.equal(rolled.broke, true);
    assert.equal(rolled.state.current, 0);
    assert.equal(rolled.state.longest, 7);
    assert.equal(rolled.state.lastGoalDate, null);
    assert.equal(markStreakDay(rolled.state, "2026-11-10").current, 1);
  });

  test("an older day never moves the streak backwards", () => {
    const s = markStreakDay(emptyStreak(), "2026-11-09");
    assert.equal(markStreakDay(s, "2026-11-08"), s);
  });
});
