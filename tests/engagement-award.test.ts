// Engagement Phase 0: the award engine against a throwaway in-memory MongoDB —
// idempotent keys, the daily practice cap, the speed guard, the late-night
// guard, IST days, goals and streaks (freezes, exam-day protection), levels,
// and the per-tuition flag. Times are passed in, so IST edges are exact.
// Run with: npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";

let mongod: MongoMemoryReplSet;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  return {
    db: await import("@/lib/db"),
    award: await import("@/lib/engagement/award"),
    rules: await import("@/lib/engagement/rules"),
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    XpEvent: (await import("@/models/XpEvent")).default,
    DailyActivity: (await import("@/models/DailyActivity")).default,
    StudentEngagement: (await import("@/models/StudentEngagement")).default,
  };
}

let tuitionId = "";
let offTuitionId = "";
let n = 0;

/** A fresh student, so tests don't share streaks or caps. */
async function student(tid = tuitionId) {
  const u = await m.User.create({ email: `s${++n}@test.local`, name: `S${n}`, passwordHash: "x", role: "student", tuitionId: tid, emailVerified: true });
  return { _id: String(u._id), tuitionId: tid, batchId: null };
}

/** IST wall-clock time: day offset from Monday 2026-11-09, at hh:mm:ss IST. */
const ist = (day: number, hh = 12, mm = 0, ss = 0) => new Date(Date.UTC(2026, 10, 9 + day, hh, mm, ss) - 5.5 * 3600 * 1000);

type S = Awaited<ReturnType<typeof student>>;
let k = 0;
const give = (s: S, xp: number, at: Date, extra: Record<string, unknown> = {}) =>
  m.award.award({ student: s, kind: "test.kind", key: `t:${++k}`, xp, at, ...extra });
const me = (r: Awaited<ReturnType<typeof give>> | null) => {
  assert.ok(r && r.enabled, "expected an enabled result");
  return r;
};

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\//, "tests must only run against the in-memory server");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "engagement_award";
  process.env.JWT_SECRET = "engagement-award-jwt-secret-0123456789abcdef";
  m = await load();
  await m.db.connectDB();
  await Promise.all([m.XpEvent.init(), m.DailyActivity.init(), m.StudentEngagement.init()]);
  tuitionId = String((await m.Tuition.create({ name: "On" }))._id);
  offTuitionId = String((await m.Tuition.create({ name: "Off", engagement: { enabled: false } }))._id);
});

after(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("idempotency", () => {
  test("the same key awards once, also when sent at the same time", async () => {
    const s = await student();
    const at = ist(0);
    const input = { student: s, kind: "practice.correct", key: `practice:${s._id}:q1:first`, xp: 15, at, practice: true };
    const first = me(await m.award.award(input));
    assert.equal(first.xpAwarded, 15);
    assert.equal(first.duplicate, false);
    const again = me(await m.award.award(input));
    assert.equal(again.xpAwarded, 0);
    assert.equal(again.duplicate, true);
    assert.equal(again.me.xp.total, 15);

    const together = await Promise.all(Array.from({ length: 5 }, () => m.award.award({ ...input, key: `practice:${s._id}:q2:first` })));
    assert.equal(together.filter((r) => r.enabled && !r.duplicate).length, 1);
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 2);
    const eng = await m.StudentEngagement.findOne({ studentId: s._id });
    assert.equal(eng.totalXp, 30);
    const day = await m.DailyActivity.findOne({ studentId: s._id, date: "2026-11-09" });
    assert.equal(day.xp, 30);
  });
});

describe("daily practice cap", () => {
  test("practice XP stops at 400 a day; the crossing award is trimmed; other XP still counts", async () => {
    const s = await student();
    const awarded: number[] = [];
    for (let i = 0; i < 22; i++) {
      // 10 s apart: never trips the speed guard
      const r = me(await give(s, 20, new Date(ist(0, 10).getTime() + i * 10_000), { practice: true }));
      awarded.push(r.xpAwarded);
    }
    assert.equal(awarded.slice(0, 20).every((x) => x === 20), true);
    assert.deepEqual(awarded.slice(20), [0, 0]);
    const odd = me(await give(s, 15, ist(0, 11), { practice: true }));
    assert.equal(odd.xpAwarded, 0);
    const self = me(await give(s, 60, ist(0, 11, 30)));
    assert.equal(self.xpAwarded, 60);
    assert.equal(self.me.today.practiceXp, 400);
    assert.equal(self.me.today.xp, 460);

    const t = await student();
    for (let i = 0; i < 26; i++) await give(t, 15, new Date(ist(0, 10).getTime() + i * 10_000), { practice: true }); // 390
    const crossing = me(await give(t, 15, ist(0, 11), { practice: true }));
    assert.equal(crossing.xpAwarded, 10);
    // The cap is per IST day: the next day starts again.
    assert.equal(me(await give(t, 15, ist(1, 10), { practice: true })).xpAwarded, 15);
  });
});

describe("speed guard", () => {
  test("more than 3 fast answers in a row earn 0 (still recorded); a normal gap resets it", async () => {
    const s = await student();
    const t0 = ist(0, 9).getTime();
    const xp: number[] = [];
    for (let i = 0; i < 6; i++) xp.push(me(await give(s, 10, new Date(t0 + i * 1000), { practice: true })).xpAwarded);
    assert.deepEqual(xp, [10, 10, 10, 10, 0, 0]);
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 6, "zero-XP answers are still in the ledger");
    assert.equal(me(await give(s, 10, new Date(t0 + 5000 + 4000), { practice: true })).xpAwarded, 10);
    // Non-practice awards are not speed-guarded.
    assert.equal(me(await give(s, 50, new Date(t0 + 9500))).xpAwarded, 50);
  });
});

describe("late-night guard", () => {
  test("00:00–05:00 IST XP counts but is not league XP", async () => {
    const s = await student();
    await give(s, 10, ist(0, 23, 59, 59));
    await give(s, 10, ist(1, 0, 0, 0));
    await give(s, 10, ist(1, 4, 59, 59));
    await give(s, 10, ist(1, 5, 0, 0));
    const events = await m.XpEvent.find({ studentId: s._id }).sort({ at: 1 }).lean<{ league: boolean; date: string }[]>();
    assert.deepEqual(events.map((e) => e.league), [true, false, false, true]);
    assert.deepEqual(events.map((e) => e.date), ["2026-11-09", "2026-11-10", "2026-11-10", "2026-11-10"]);
    assert.equal((await m.StudentEngagement.findOne({ studentId: s._id })).totalXp, 40);
  });
});

describe("IST days and weeks", () => {
  test("an award lands on the IST day and week it happened in", async () => {
    const s = await student();
    await give(s, 10, ist(-1, 23, 59, 59)); // Sunday 2026-11-08
    await give(s, 10, ist(0, 0, 0, 0)); // Monday 2026-11-09
    const events = await m.XpEvent.find({ studentId: s._id }).sort({ at: 1 }).lean<{ date: string; weekKey: string }[]>();
    assert.deepEqual(events.map((e) => [e.date, e.weekKey]), [["2026-11-08", "2026-W45"], ["2026-11-09", "2026-W46"]]);
    assert.equal(await m.DailyActivity.countDocuments({ studentId: s._id }), 2);
  });
});

describe("goal and streak", () => {
  test("Regular goal 100: meeting it secures the day once; days chain; a gap without freezes resets", async () => {
    const s = await student();
    let r = me(await give(s, 60, ist(0, 10)));
    assert.equal(r.me.today.goal, 100);
    assert.equal(r.me.today.goalMet, false);
    assert.equal(r.me.streak.current, 0);
    r = me(await give(s, 50, ist(0, 11)));
    assert.equal(r.me.today.goalMet, true);
    assert.equal(r.me.streak.current, 1);
    assert.equal(r.me.streak.securedToday, true);
    r = me(await give(s, 100, ist(0, 12)));
    assert.equal(r.me.streak.current, 1, "the same day counts once");

    r = me(await give(s, 100, ist(1, 10)));
    assert.equal(r.me.streak.current, 2);
    // Day 2 skipped, no freezes: day 3 starts over, the longest is kept.
    r = me(await give(s, 100, ist(3, 23, 59)));
    assert.equal(r.me.streak.current, 1);
    assert.equal(r.me.streak.longest, 2);
  });

  test("the goal is met by IST midnight: XP after midnight counts for the next day", async () => {
    const s = await student();
    me(await give(s, 90, ist(0, 23, 50)));
    const r = me(await give(s, 20, ist(1, 0, 5)));
    assert.equal(r.me.today.date, "2026-11-10");
    assert.equal(r.me.today.xp, 20);
    assert.equal(r.me.streak.current, 0);
    assert.equal((await m.DailyActivity.findOne({ studentId: s._id, date: "2026-11-09" })).goalMet, false);
  });

  test("7 days earn a freeze; a missed day spends it and the streak continues", async () => {
    const s = await student();
    let r;
    for (let d = 0; d < 7; d++) r = me(await give(s, 100, ist(d, 18)));
    assert.equal(r!.me.streak.current, 7);
    assert.equal(r!.me.streak.freezes, 1);
    // Day 7 missed; day 8 rolls the streak with the freeze.
    r = me(await give(s, 10, ist(8, 9)));
    assert.equal(r.me.streak.freezes, 0);
    assert.equal(r.me.streak.current, 7);
    assert.equal(r.me.streak.securedToday, false);
    r = me(await give(s, 90, ist(8, 10)));
    assert.equal(r.me.streak.current, 8);
  });

  test("the snapshot rolls the streak lazily (no cron)", async () => {
    const s = await student();
    me(await give(s, 100, ist(0, 10)));
    const later = await m.award.engagementSnapshot(s, ist(5, 10));
    assert.ok(later.enabled);
    assert.equal(later.me.streak.current, 0);
    assert.equal(later.me.streak.longest, 1);
    assert.equal(later.me.today.xp, 0);
  });
});

describe("exam-day protection", () => {
  test("a test written today secures the streak below the goal", async () => {
    const s = await student();
    me(await give(s, 100, ist(0, 10)));
    const r = me(await give(s, 80, ist(1, 15), { kind: "test.submitted", streakDate: "2026-11-10" }));
    assert.equal(r.me.today.goalMet, false);
    assert.equal(r.me.streak.current, 2);
    assert.equal(r.me.streak.securedToday, true);
    assert.equal((await m.DailyActivity.findOne({ studentId: s._id, date: "2026-11-10" })).testDay, true);
  });

  test("a test written on an earlier day gives XP but doesn't touch the streak", async () => {
    const s = await student();
    me(await give(s, 100, ist(0, 10)));
    const r = me(await give(s, 80, ist(2, 9), { kind: "test.submitted", streakDate: "2026-11-10" }));
    assert.equal(r.xpAwarded, 80);
    assert.equal(r.me.streak.current, 0);
    assert.equal(r.me.streak.securedToday, false);
  });

  test("testEngagement: started today → streak day; not submitted (paused) → nothing", async () => {
    const s = await student();
    const testId = "64b000000000000000000001";
    const base = { testId, studentId: s._id, tuitionId: s.tuitionId, batchId: null };
    assert.equal(await m.rules.testEngagement({ ...base, startedAt: new Date(), submittedAt: null }), null);
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 0);
    const r = me(await m.rules.testEngagement({ ...base, startedAt: new Date(), submittedAt: new Date() }));
    assert.equal(r.xpAwarded, 80);
    assert.equal(r.me.streak.securedToday, true);
    assert.ok(await m.XpEvent.exists({ key: `test:${s._id}:${testId}` }));
    const again = me(await m.rules.testEngagement({ ...base, startedAt: new Date(), submittedAt: new Date() }));
    assert.equal(again.duplicate, true);
    assert.equal(again.me.xp.total, 80);
  });
});

describe("practice rules", () => {
  const q = (id: string, difficulty?: string) => ({ _id: id, difficulty, subject: "Physics", chapter: "Kinematics", topic: "Projectile Motion" });

  test("first try right = 10 × difficulty, wrong = 2, a fix = 15 once a day, a re-answer = 0", async () => {
    const s = await student();
    let t = ist(0, 8).getTime();
    const at = () => new Date((t += 10_000));
    assert.equal(me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a1", "Easy"), { correct: true, prev: null }, at())).xpAwarded, 10);
    assert.equal(me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a2", "Medium"), { correct: true, prev: null }, at())).xpAwarded, 15);
    assert.equal(me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a3", "Hard"), { correct: true, prev: null }, at())).xpAwarded, 20);
    assert.equal(me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a4"), { correct: true, prev: null }, at())).xpAwarded, 10);
    assert.equal(me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a5", "Hard"), { correct: false, prev: null }, at())).xpAwarded, 2);
    const fix = me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a5", "Hard"), { correct: true, prev: { correct: false } }, at()));
    assert.equal(fix.xpAwarded, 15);
    assert.ok(await m.XpEvent.exists({ key: `fix:${s._id}:64b0000000000000000000a5:2026-11-09`, kind: "mistake.fixed" }));
    const fixAgain = me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a5", "Hard"), { correct: true, prev: { correct: false } }, at()));
    assert.equal(fixAgain.duplicate, true);
    const reanswer = me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a1", "Easy"), { correct: true, prev: { correct: true } }, at()));
    assert.equal(reanswer.xpAwarded, 0);
    const wrongAgain = me(await m.rules.practiceEngagement(s, q("64b0000000000000000000a5", "Hard"), { correct: false, prev: { correct: false } }, at()));
    assert.equal(wrongAgain.xpAwarded, 0);
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 6);
    assert.equal(fixAgain.me.xp.total, 10 + 15 + 20 + 10 + 2 + 15);
    // A failed read of the previous answer awards nothing.
    assert.equal(await m.rules.practiceEngagement(s, q("64b0000000000000000000a6"), { correct: true, prev: undefined }, at()), null);
  });

  test("self-assessment: 3 per attempted question, max 120, once", async () => {
    const s = await student();
    const answers = (attempted: number, total: number) => Array.from({ length: total }, (_, i) => ({ selected: i < attempted ? "A" : null }));
    const r = me(await m.rules.selfAssessmentEngagement(s, { _id: "64b0000000000000000000b1", submittedAt: new Date(), answers: answers(7, 10) }));
    assert.equal(r.xpAwarded, 21);
    const big = me(await m.rules.selfAssessmentEngagement(s, { _id: "64b0000000000000000000b2", submittedAt: new Date(), answers: answers(60, 60) }));
    assert.equal(big.xpAwarded, 120);
    const twice = me(await m.rules.selfAssessmentEngagement(s, { _id: "64b0000000000000000000b2", submittedAt: new Date(), answers: answers(60, 60) }));
    assert.equal(twice.duplicate, true);
    const none = me(await m.rules.selfAssessmentEngagement(s, { _id: "64b0000000000000000000b3", submittedAt: new Date(), answers: answers(0, 10) }));
    assert.equal(none.xpAwarded, 0);
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 2);
  });
});

describe("levels", () => {
  test("crossing 100 XP stores level 2 and the progress to level 3", async () => {
    const s = await student();
    const r = me(await give(s, 150, ist(0, 10)));
    assert.equal(r.me.xp.level, 2);
    assert.equal(r.me.xp.toNext, 150);
    assert.equal((await m.StudentEngagement.findOne({ studentId: s._id })).level, 2);
  });
});

describe("per-tuition flag", () => {
  test("engagement off: nothing is awarded or stored", async () => {
    const s = await student(offTuitionId);
    assert.deepEqual(await give(s, 50, ist(0, 10)), { enabled: false });
    assert.deepEqual(await m.award.engagementSnapshot(s), { enabled: false });
    assert.equal(await m.XpEvent.countDocuments({ studentId: s._id }), 0);
    assert.equal(await m.StudentEngagement.countDocuments({ studentId: s._id }), 0);
  });

  test("safeAward turns an engine failure into null", async () => {
    const s = await student();
    const original = m.award.engine.award;
    m.award.engine.award = async () => {
      throw new Error("boom");
    };
    try {
      assert.equal(await m.award.safeAward({ student: s, kind: "x", key: "boom:1", xp: 5 }), null);
      assert.equal(await m.rules.testEngagement({ testId: "64b000000000000000000002", studentId: s._id, tuitionId: s.tuitionId, startedAt: new Date(), submittedAt: new Date() }), null);
    } finally {
      m.award.engine.award = original;
    }
  });
});
