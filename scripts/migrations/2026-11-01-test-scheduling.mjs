// Migration 2026-11-01-test-scheduling (version 1)
//
// Tests now always have a closing time (`closesAt` is required), and tests are
// listed by when they open. This migration:
//   1. gives every testrooms document that has no closesAt one: opensAt + 24 hours
//      (the same default window the app used for "after 1 day"). The ids changed are
//      recorded in `schemamigrations`, so --rollback can put them back to open-ended.
//   2. creates the index testrooms { tuitionId, batchId, opensAt: -1 }.
// It changes no other field of any test, and writes nothing to testattempts, questions,
// papers or any other collection. It never deletes a document or a collection.
//
// Modes (the default is a read-only dry run):
//   node --env-file=.env.local scripts/migrations/2026-11-01-test-scheduling.mjs
//   ... --backup --out <dir>                       exports testrooms, testattempts and schemamigrations, verified
//   ... --apply --confirm-db pcmb --backup-dir <dir> [--allow-remote]
//   ... --verify                                   checks no test lacks closesAt, the index, and that content counts are unchanged
//   ... --rollback --confirm-db pcmb [--allow-remote]   undoes step 1 for the recorded ids and drops the index
//
// <dir> must be outside this repository (backups hold student data). Nothing but
// counts and index names is ever printed.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import mongoose from "mongoose";
import { EJSON } from "bson";

export const MIGRATION_ID = "2026-11-01-test-scheduling";
const RECORDS = "schemamigrations";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Collections the backup covers: everything this migration reads or writes. */
const BACKUP = ["testrooms", "testattempts", RECORDS];
/** Collections that hold academic content or other data: counts are compared before and after, never written. */
const PROTECTED = ["paper", "questions", "testattempts", "attempts", "practiceanswers", "selfassessments", "syllabusprogresses", "chapterweightages", "storedfiles", "timetableentries", "announcements", "users", "batches", "tuitions"];
const INDEX = { collection: "testrooms", key: { tuitionId: 1, batchId: 1, opensAt: -1 }, options: { name: "tuitionId_1_batchId_1_opensAt_-1" } };

const args = new Set(process.argv.slice(2));
const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && !process.argv[i + 1]?.startsWith("--") ? process.argv[i + 1] : undefined;
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const say = (msg) => console.log(msg);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI (node --env-file=.env.local …).");
  process.exit(2);
}
const dbName = process.env.MONGODB_DB || (/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(uri) ? undefined : "pcmb");
await mongoose.connect(uri, { dbName });
const db = mongoose.connection.db;
const remote = !/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri);

async function exists(name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}
async function counts(names) {
  const out = {};
  for (const n of names) out[n] = (await exists(n)) ? await db.collection(n).countDocuments() : null;
  return out;
}
const hasIndex = async () => (await exists(INDEX.collection)) && (await db.collection(INDEX.collection).indexes()).some((i) => i.name === INDEX.options.name);
const withoutClose = () => ({ $or: [{ closesAt: null }, { closesAt: { $exists: false } }] });
const testsWithoutClose = async () => ((await exists("testrooms")) ? db.collection("testrooms").countDocuments(withoutClose()) : 0);

try {
  say(`database "${db.databaseName}" on MongoDB ${(await db.admin().serverInfo()).version}${remote ? " (remote)" : " (local)"}`);

  if (args.has("--backup")) {
    const out = opt("out");
    if (!out) throw new Error("--backup needs --out <dir>.");
    const dir = resolve(out);
    if (!relative(process.cwd(), dir).startsWith("..")) throw new Error("The backup directory must be outside this repository.");
    mkdirSync(dir, { recursive: true });
    const manifest = { migration: MIGRATION_ID, database: db.databaseName, createdAt: new Date().toISOString(), collections: {}, indexes: {} };
    for (const name of BACKUP) {
      if (!(await exists(name))) continue;
      const docs = await db.collection(name).find({}).toArray();
      const text = EJSON.stringify(docs, { relaxed: false }, 2);
      writeFileSync(join(dir, `${name}.ejson`), text);
      manifest.collections[name] = { documents: docs.length, sha256: sha(text) };
      manifest.indexes[name] = await db.collection(name).indexes();
    }
    manifest.contentCounts = await counts(PROTECTED);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    for (const [name, info] of Object.entries(manifest.collections)) {
      const back = readFileSync(join(dir, `${name}.ejson`), "utf8");
      const live = await db.collection(name).countDocuments();
      if (sha(back) !== info.sha256 || EJSON.parse(back).length !== info.documents || live !== info.documents) throw new Error(`Backup of ${name} did not verify.`);
      say(`backed up ${name}: ${info.documents} documents, verified`);
    }
    say(`backup verified: ${dir}`);
  } else if (args.has("--apply") || args.has("--rollback")) {
    if (opt("confirm-db") !== db.databaseName) throw new Error(`Pass --confirm-db ${db.databaseName} to write.`);
    if (remote && !args.has("--allow-remote")) throw new Error("This is a remote database: add --allow-remote to write.");
    const records = db.collection(RECORDS);
    const before = await counts(PROTECTED);
    if (args.has("--rollback")) {
      const record = await records.findOne({ _id: MIGRATION_ID });
      const ids = (record?.runs ?? []).flatMap((r) => r.testsGivenClosingTime ?? []);
      if (ids.length) {
        const res = await db.collection("testrooms").updateMany({ _id: { $in: ids } }, { $set: { closesAt: null } });
        say(`set ${res.modifiedCount} tests back to open-ended`);
      }
      if (await hasIndex()) {
        await db.collection(INDEX.collection).dropIndex(INDEX.options.name);
        say(`dropped ${INDEX.collection}.${INDEX.options.name}`);
      }
      await records.updateOne({ _id: MIGRATION_ID }, { $set: { status: "rolled-back", rolledBackAt: new Date() } });
    } else {
      const dir = opt("backup-dir");
      if (!dir) throw new Error("--apply needs --backup-dir <dir> from a verified --backup.");
      const manifest = JSON.parse(readFileSync(join(resolve(dir), "manifest.json"), "utf8"));
      if (manifest.database !== db.databaseName) throw new Error("That backup is of another database.");
      for (const [name, info] of Object.entries(manifest.collections)) {
        if (sha(readFileSync(join(resolve(dir), `${name}.ejson`), "utf8")) !== info.sha256) throw new Error(`Backup file of ${name} changed.`);
      }
      const targets = (await db.collection("testrooms").find(withoutClose()).project({ _id: 1 }).toArray()).map((d) => d._id);
      if (targets.length) {
        // Only those tests, only that field.
        const res = await db.collection("testrooms").updateMany({ _id: { $in: targets }, ...withoutClose() }, [{ $set: { closesAt: { $add: ["$opensAt", DAY_MS] } } }]);
        say(`gave ${res.modifiedCount} test(s) a closing time (opens + 24 hours)`);
      }
      if (!(await hasIndex())) {
        await db.collection(INDEX.collection).createIndex(INDEX.key, INDEX.options);
        say(`created ${INDEX.collection}.${INDEX.options.name}`);
      }
      await records.updateOne(
        { _id: MIGRATION_ID },
        { $set: { version: 1, status: "applied", appliedAt: new Date() }, $setOnInsert: { createdAt: new Date() }, $push: { runs: { at: new Date(), testsGivenClosingTime: targets, backup: manifest.createdAt } } },
        { upsert: true }
      );
    }
    const after = await counts(PROTECTED);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("A protected collection changed during the run. Investigate.");
    say("protected collections unchanged");
  } else if (args.has("--verify")) {
    const missing = await testsWithoutClose();
    const indexed = await hasIndex();
    say(`tests without a closing time: ${missing}`);
    say(`${indexed ? "ok     " : "MISSING"} ${INDEX.collection}.${INDEX.options.name}`);
    say(`collections (documents): ${JSON.stringify(await counts([...PROTECTED, "testrooms"]))}`);
    if (missing || !indexed) process.exitCode = 1;
  } else {
    say("DRY RUN: nothing is written.");
    say(`tests without a closing time (to be given opens + 24 hours): ${await testsWithoutClose()}`);
    say(`${(await hasIndex()) ? "present" : "to create"}  ${INDEX.collection}.${INDEX.options.name}`);
    say(`documents in collections to back up: ${JSON.stringify(await counts(BACKUP))}`);
    say(`protected collections (never written): ${JSON.stringify(await counts(PROTECTED))}`);
  }
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
