// Flags multiple-choice questions whose options are broken in the data, for a
// person to fix. It never invents or edits question content.
//
// Broken = an MCQ with a gap in its options (B empty while C has text), only
// option A, or an answer key pointing at an empty option. Two- and
// three-option questions (True/False…) are NOT broken and are left alone.
//
//   node scripts/flag-broken-mcq-options.mjs              # dry run (default): counts + before/after for 5
//   node scripts/flag-broken-mcq-options.mjs --apply      # backs up, then writes the flags
//
// --apply first writes every affected document, in full, to
// backups/flag-broken-mcq-options-<time>.json, then sets ONLY
//   reviewFlags: { options: [reasons…], flaggedAt }
// on those documents (matched by _id and an unchanged option set, so nothing
// edited meanwhile is touched). Undo: $unset reviewFlags on the backed-up ids.
// Needs MONGODB_URI (and MONGODB_DB, else "pcmb", as src/lib/db.ts). The rule is the same as
// src/lib/question-review.ts (optionReviewReasons), which the app uses to clear a flag on edit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const uri = process.env.MONGODB_URI ?? env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? env.MONGODB_DB ?? "pcmb";
const KEYS = ["A", "B", "C", "D"];

const filled = (q, k) => !!String(q[`option${k}`] ?? "").trim() || (q.optionDiagramUrls?.[k]?.length ?? 0) > 0;

/** Why a question's options are broken; [] when they're fine. */
export function reasonsOf(q) {
  if (q.answerType !== "MCQ") return [];
  const has = KEYS.map((k) => filled(q, k));
  const last = has.lastIndexOf(true);
  const reasons = [];
  if (last < 0) reasons.push("no-options");
  else if (has.slice(0, last).some((h) => !h)) reasons.push("gap");
  if (last === 0) reasons.push("only-a");
  const key = String(q.correctAnswer ?? "").trim().toUpperCase();
  if (KEYS.includes(key) && !has[KEYS.indexOf(key)]) reasons.push("key-on-empty-option");
  return reasons;
}

const client = new MongoClient(uri);
await client.connect();
try {
  const questions = client.db(dbName).collection("questions");
  // Candidates: MCQs with at least one empty option field (cheap filter), then checked exactly here.
  const empty = (k) => ({ $or: [{ [`option${k}`]: { $in: [null, ""] } }, { [`option${k}`]: { $exists: false } }, { [`option${k}`]: /^\s+$/ }] });
  const fields = { questionText: 1, optionA: 1, optionB: 1, optionC: 1, optionD: 1, optionDiagramUrls: 1, correctAnswer: 1, answerType: 1, subject: 1, chapter: 1, source: 1 };
  const candidates = await questions.find({ answerType: "MCQ", $or: KEYS.map(empty) }, { projection: fields }).toArray();
  const broken = candidates.map((q) => ({ q, reasons: reasonsOf(q) })).filter((x) => x.reasons.length);

  const byReason = {};
  for (const { reasons } of broken) for (const r of reasons) byReason[r] = (byReason[r] ?? 0) + 1;
  console.log(`${apply ? "APPLY" : "DRY RUN"} · db ${dbName} · MCQs with an empty option: ${candidates.length} · broken: ${broken.length}`, byReason);
  const flagsOf = (reasons) => ({ options: reasons, flaggedAt: new Date() });
  for (const { q, reasons } of broken.slice(0, 5)) {
    const opts = Object.fromEntries(KEYS.map((k) => [k, String(q[`option${k}`] ?? "").slice(0, 40)]));
    console.log(`\n${q._id} · ${q.subject} · ${q.chapter} · ${q.source || "no source"} · key ${q.correctAnswer || "–"}`);
    console.log("  before:", JSON.stringify({ options: opts, reviewFlags: q.reviewFlags ?? null }));
    console.log("  after: ", JSON.stringify({ options: opts, reviewFlags: flagsOf(reasons) }), "(options unchanged)");
  }
  console.log(`\nAll ${broken.length} (id · subject · chapter · key · reasons):`);
  for (const { q, reasons } of broken) console.log(`  ${q._id} · ${q.subject} · ${q.chapter} · key ${q.correctAnswer || "–"} · ${reasons.join(", ")}`);
  if (!apply) {
    console.log("\nNothing written. Re-run with --apply to back up and flag.");
  } else {
    const full = await questions.find({ _id: { $in: broken.map((x) => x.q._id) } }).toArray();
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    const file = new URL(`../backups/flag-broken-mcq-options-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
    writeFileSync(file, JSON.stringify(full, null, 2));
    console.log(`\nBacked up ${full.length} documents to ${file.pathname}`);
    let changed = 0;
    for (const { q, reasons } of broken) {
      // Only if the options are still exactly as read: a question fixed meanwhile is left alone.
      const same = Object.fromEntries(KEYS.map((k) => [`option${k}`, q[`option${k}`] ?? null]));
      const r = await questions.updateOne({ _id: q._id, ...same, correctAnswer: q.correctAnswer ?? null }, { $set: { reviewFlags: flagsOf(reasons) } });
      changed += r.modifiedCount;
    }
    console.log(`Flagged ${changed} of ${broken.length}.`);
  }
} finally {
  await client.close();
}
