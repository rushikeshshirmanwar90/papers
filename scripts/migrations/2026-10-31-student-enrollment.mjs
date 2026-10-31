// Migration 2026-10-31-student-enrollment (version 1)
//
// Student joining codes added fields and one collection, all optional, so no
// existing document needs rewriting. The only database work is creating the
// indexes the feature relies on:
//   joinrequests   one_pending_per_user   unique {userId} where status = "pending"
//   batchinvites   batchId_1               unique {batchId}
//                  codeHash_1              unique sparse {codeHash}
//                  tuitionId_1             {tuitionId}
// It writes nothing else except its own record in `schemamigrations`. It never
// reads or changes questions, papers, tests, attempts or any other content, and
// never deletes a document or a collection.
//
// Modes (the default is a read-only dry run):
//   node --env-file=.env.local scripts/migrations/2026-10-31-student-enrollment.mjs
//   ... --backup --out <dir>                    exports the collections it concerns, verified, to <dir>
//   ... --apply --confirm-db pcmb --backup-dir <dir> [--allow-remote]   creates the indexes
//   ... --verify                                checks the indexes and that content counts are unchanged
//   ... --rollback --confirm-db pcmb [--allow-remote]   drops only the indexes created here
//
// <dir> must be outside this repository (backups hold student data). Nothing
// but counts and index names is ever printed.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import mongoose from "mongoose";
import { EJSON } from "bson";

export const MIGRATION_ID = "2026-10-31-student-enrollment";
const RECORDS = "schemamigrations";
/** Collections the backup covers: everything the feature reads or writes. */
const BACKUP = ["users", "batches", "tuitions", "joinrequests", "batchinvites", RECORDS];
/** Collections that hold academic content: counts are compared before and after, never written. */
const PROTECTED = ["paper", "questions", "testrooms", "testattempts", "attempts", "practiceanswers", "selfassessments", "syllabusprogresses", "chapterweightages", "storedfiles", "timetableentries", "announcements"];

const INDEXES = [
  { collection: "joinrequests", key: { userId: 1 }, options: { name: "one_pending_per_user", unique: true, partialFilterExpression: { status: "pending" } } },
  { collection: "batchinvites", key: { batchId: 1 }, options: { name: "batchId_1", unique: true } },
  { collection: "batchinvites", key: { codeHash: 1 }, options: { name: "codeHash_1", unique: true, sparse: true } },
  { collection: "batchinvites", key: { tuitionId: 1 }, options: { name: "tuitionId_1" } },
];

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
async function hasIndex({ collection, options }) {
  return (await exists(collection)) && (await db.collection(collection).indexes()).some((i) => i.name === options.name);
}
/** Pending requests per person above one: these would stop the unique index being built. */
async function duplicatePending() {
  if (!(await exists("joinrequests"))) return 0;
  const rows = await db.collection("joinrequests").aggregate([{ $match: { status: "pending" } }, { $group: { _id: "$userId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "n" }]).toArray();
  return rows[0]?.n ?? 0;
}

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
    // Verify: read each file back and compare it with the live collection.
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
    if (args.has("--rollback")) {
      for (const spec of INDEXES.slice().reverse()) {
        if (await hasIndex(spec)) {
          await db.collection(spec.collection).dropIndex(spec.options.name);
          say(`dropped ${spec.collection}.${spec.options.name}`);
        }
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
      if (await duplicatePending()) throw new Error("Some people have more than one pending join request: resolve them before building the unique index.");
      const before = await counts(PROTECTED);
      const made = [];
      for (const spec of INDEXES) {
        if (await hasIndex(spec)) continue;
        await db.collection(spec.collection).createIndex(spec.key, spec.options);
        made.push(`${spec.collection}.${spec.options.name}`);
        say(`created ${spec.collection}.${spec.options.name}`);
      }
      const after = await counts(PROTECTED);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("A content collection changed during the run. Investigate.");
      await records.updateOne(
        { _id: MIGRATION_ID },
        { $set: { version: 1, status: "applied", appliedAt: new Date() }, $setOnInsert: { createdAt: new Date() }, $push: { runs: { at: new Date(), indexesCreated: made, backup: manifest.createdAt } } },
        { upsert: true }
      );
    }
  } else if (args.has("--verify")) {
    let bad = 0;
    for (const spec of INDEXES) {
      const ok = await hasIndex(spec);
      if (!ok) bad++;
      say(`${ok ? "ok     " : "MISSING"} ${spec.collection}.${spec.options.name}`);
    }
    const dup = await duplicatePending();
    say(`people with more than one pending request: ${dup}`);
    const counts_ = await counts(PROTECTED);
    say(`content collections (documents): ${JSON.stringify(counts_)}`);
    if (bad || dup) process.exitCode = 1;
  } else {
    say("DRY RUN: nothing is written.");
    for (const spec of INDEXES) say(`${(await hasIndex(spec)) ? "present" : "to create"}  ${spec.collection}.${spec.options.name}`);
    const dup = await duplicatePending();
    say(`people with more than one pending request (blocker if > 0): ${dup}`);
    say(`documents in collections to back up: ${JSON.stringify(await counts(BACKUP))}`);
    say(`content collections (never written): ${JSON.stringify(await counts(PROTECTED))}`);
    if (dup) process.exitCode = 1;
  }
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
