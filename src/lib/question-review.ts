// Multiple-choice questions whose options are broken in the data (from an
// import), flagged for a person to fix: a gap in the options (B empty while C
// has text), only option A, no options at all, or an answer key on an empty
// option. Two- and three-option questions (True/False…) are fine.
// scripts/flag-broken-mcq-options.mjs applies the same rule to the bank.

const KEYS = ["A", "B", "C", "D"] as const;

export type OptionReason = "no-options" | "gap" | "only-a" | "key-on-empty-option";

type Q = {
  answerType?: unknown;
  correctAnswer?: unknown;
  optionA?: unknown;
  optionB?: unknown;
  optionC?: unknown;
  optionD?: unknown;
  optionDiagramUrls?: Partial<Record<(typeof KEYS)[number], unknown[]>> | null;
};

const filled = (q: Q, k: (typeof KEYS)[number]) => !!String(q[`option${k}`] ?? "").trim() || (q.optionDiagramUrls?.[k]?.length ?? 0) > 0;

/** Why a question's options are broken; [] when they're fine (or it isn't an MCQ). */
export function optionReviewReasons(q: Q): OptionReason[] {
  if (q.answerType !== "MCQ") return [];
  const has = KEYS.map((k) => filled(q, k));
  const last = has.lastIndexOf(true);
  const reasons: OptionReason[] = [];
  if (last < 0) reasons.push("no-options");
  else if (has.slice(0, last).some((h) => !h)) reasons.push("gap");
  if (last === 0) reasons.push("only-a");
  const key = String(q.correctAnswer ?? "").trim().toUpperCase();
  const at = KEYS.indexOf(key as (typeof KEYS)[number]);
  if (at >= 0 && !has[at]) reasons.push("key-on-empty-option");
  return reasons;
}
