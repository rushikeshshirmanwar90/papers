// Migration 2026-10-30-step25-academic-programs (version 1)
//
// Adds the Step 2 `program` field to existing batches and students, in their
// existing collections, only where the program is certain:
//   batch with track JEE  -> program JEE      batch with track NEET  -> program NEET
//   student with track JEE / NEET -> the same program, unless their batch says otherwise
// Everything else (track "General" or missing, a student whose batch is of
// another program, missing class, year or batch) is listed for manual review
// and left unchanged. The timetable is reported, never changed: the subject
// timetable (timetableentries) is the one the app uses; a batch's older
// time-only slots (Batch.schedule) have no subject, so they're listed for
// someone to recreate as subject classes, never turned into classes here. Nothing else is ever written: no class, subject, year,
// tuition or batch is filled in, no field but `program` is touched, nothing is
// deleted, no collection is dropped or renamed. Questions, papers, test
// attempts, practice answers and syllabus records are never read for writing.
//
// Modes (the default is a read-only dry run):
//   node --env-file=.env.local scripts/migrations/2026-10-30-step25-academic-programs.mjs
//        [--db pcmb] [--out plan.json] [--reveal refs.json]
//   ... --apply    --confirm-db pcmb [--allow-remote]   writes, records what it changed
//   ... --verify                                        checks an applied run (read-only)
//   ... --rollback --confirm-db pcmb [--allow-remote]   removes only the `program` values it set
//
// Record ids are shown as anonymous refs (B-…, S-…, T-…). --reveal writes the
// ref → _id map to a local file for whoever reviews the records; keep it out of Git.
//
// The run is recorded in the `schemamigrations` collection (created on the
// first --apply), so applying again only picks up records that still need it,
// and --verify / --rollback know exactly which documents were changed.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";

export const MIGRATION_ID = "2026-10-30-step25-academic-programs";
export const MIGRATION_VERSION = 1;
const RECORDS = "schemamigrations";
/** The only collections this migration may write to. */
const WRITABLE = new Set(["users", "batches", RECORDS]);

const CERTAIN = { JEE: "JEE", NEET: "NEET" };

// ─── Pure planning ─────────────────────────────────────────────────────────

const str = (id) => (id == null ? null : String(id));

/** The program a batch has or would get; null when uncertain. */
function batchProgram(b) {
  if (b.program) return b.program;
  return CERTAIN[b.track] ?? null;
}

/**
 * The plan for a snapshot of the data: which documents get which `program`,
 * and which need a person to look at them. `ref` makes anonymous refs.
 */
export function planMigration({ batches, users, tuitionIds, timetable = [] }, ref = (kind, id) => `${kind}-${String(id).slice(-6)}`) {
  const tuitions = new Set(tuitionIds.map(str));
  const batchById = new Map(batches.map((b) => [str(b._id), b]));
  const usersById = new Map(users.map((u) => [str(u._id), u]));
  const changes = [];
  const review = [];
  const notes = [];
  const note = (list, collection, kind, doc, reason) => list.push({ collection, ref: ref(kind, doc._id), id: str(doc._id), reason });

  for (const b of batches) {
    if (!tuitions.has(str(b.tuitionId))) note(notes, "batches", "B", b, "its tuition doesn't exist");
    const slots = (b.schedule ?? []).length;
    const classes = timetable.filter((e) => str(e.batchId) === str(b._id)).length;
    if (slots) {
      note(notes, "batches", "B", b, `${slots} older time-only class slot${slots === 1 ? "" : "s"} (no subject; ${classes} subject class${classes === 1 ? "" : "es"} in the timetable); not turned into classes. Recreate them as subject classes if still needed`);
    }
    if (!b.standard) note(notes, "batches", "B", b, "no class (made for 11th and 12th); not filled in");
    if (!b.academicYear) note(notes, "batches", "B", b, "no academic year; not filled in");
    for (const t of b.teachers ?? []) {
      const teacher = usersById.get(str(t.teacherId));
      if (!teacher || teacher.role !== "teacher") note(notes, "batches", "B", b, `a ${t.subject} teacher assignment points to no teacher`);
      else if (str(teacher.tuitionId) !== str(b.tuitionId)) note(notes, "batches", "B", b, `its ${t.subject} teacher belongs to another tuition`);
    }
    if (b.program) {
      if (CERTAIN[b.track] && CERTAIN[b.track] !== b.program) note(review, "batches", "B", b, `program ${b.program} doesn't match track ${b.track}`);
      continue;
    }
    if (CERTAIN[b.track]) changes.push({ collection: "batches", ref: ref("B", b._id), id: str(b._id), set: { program: CERTAIN[b.track] }, expect: { track: b.track } });
    else note(review, "batches", "B", b, b.track ? `track "${b.track}": could be General Tuition, MHT-CET or HSC; set its program by hand` : "no track; set its program by hand");
  }

  for (const u of users) {
    if (u.role === "teacher") {
      if (!(u.subjects ?? []).length) note(notes, "users", "T", u, "teacher with no subjects; not filled in");
      if (!tuitions.has(str(u.tuitionId))) note(notes, "users", "T", u, "teacher's tuition doesn't exist");
      if (u.track || u.batchId || u.program) note(review, "users", "T", u, "teacher has student fields (track, batch or program)");
      continue;
    }
    if (u.role !== "student") continue;
    const kind = "S";
    if (!u.tuitionId || !tuitions.has(str(u.tuitionId))) note(notes, "users", kind, u, "student's tuition is missing");
    if (!u.standard) note(notes, "users", kind, u, "no class; not filled in");
    const batch = u.batchId ? batchById.get(str(u.batchId)) : null;
    if (u.batchId && !batch) note(notes, "users", kind, u, "their batch doesn't exist");
    if (batch && str(batch.tuitionId) !== str(u.tuitionId)) note(review, "users", kind, u, "their batch belongs to another tuition");
    if (batch && u.standard && batch.standard && u.standard !== batch.standard) {
      note(review, "users", kind, u, `class ${u.standard}, but their batch is for ${batch.standard}; not changed`);
    }
    if (u.program) continue;
    const mine = CERTAIN[u.track];
    if (!mine) {
      note(review, "users", kind, u, u.track ? `track "${u.track}": could be General Tuition, MHT-CET or HSC; set their program by hand` : "no track; set their program by hand");
      continue;
    }
    const theirs = batch ? batchProgram(batch) : null;
    if (batch && theirs !== mine) {
      note(review, "users", kind, u, `track ${u.track}, but their batch is ${theirs ?? `"${batch.track}"`}; not changed`);
      continue;
    }
    changes.push({ collection: "users", ref: ref(kind, u._id), id: str(u._id), set: { program: mine }, expect: { role: "student", track: u.track } });
  }

  for (const e of timetable) {
    if (!batchById.has(str(e.batchId))) note(notes, "timetableentries", "C", e, "a timetable class of a batch that doesn't exist");
    if (e.teacherId && usersById.get(str(e.teacherId))?.role !== "teacher") note(notes, "timetableentries", "C", e, "a timetable class whose teacher isn't a teacher any more");
  }

  const count = (list, collection) => list.filter((x) => x.collection === collection).length;
  const roles = {};
  for (const u of users) roles[u.role ?? "none"] = (roles[u.role ?? "none"] ?? 0) + 1;
  return {
    migration: MIGRATION_ID,
    version: MIGRATION_VERSION,
    summary: {
      batches: batches.length,
      users: users.length,
      usersByRole: roles,
      batchesToChange: count(changes, "batches"),
      studentsToChange: count(changes, "users"),
      batchesAlreadyDone: batches.filter((b) => b.program).length,
      studentsAlreadyDone: users.filter((u) => u.role === "student" && u.program).length,
      timetableClasses: timetable.length,
      batchesWithTimeOnlySlots: batches.filter((b) => (b.schedule ?? []).length).length,
      forReview: review.length,
      notes: notes.length,
    },
    changes,
    review,
    notes,
  };
}

/** A record's fields that must never change, as one digest. */
export function protectedDigest(doc) {
  const keep = { role: doc.role ?? null, tuitionId: str(doc.tuitionId), batchId: str(doc.batchId), track: doc.track ?? null, standard: doc.standard ?? null, email: doc.email ?? null, passwordHash: doc.passwordHash ?? null, name: doc.name ?? null, subjects: doc.subjects ?? null, teachers: (doc.teachers ?? []).map((t) => [str(t.teacherId), t.subject]), schedule: doc.schedule ?? null, academicYear: doc.academicYear ?? null };
  return createHash("sha256").update(JSON.stringify(keep)).digest("hex");
}

/** A readable report of a plan, with refs only. */
export function formatPlan(plan) {
  const s = plan.summary;
  const lines = [
    `Migration ${plan.migration} (v${plan.version})`,
    `Records: ${s.batches} batches, ${s.users} users (${Object.entries(s.usersByRole).map(([r, n]) => `${n} ${r}`).join(", ")})`,
    `Would set program on: ${s.batchesToChange} batches, ${s.studentsToChange} students (already set: ${s.batchesAlreadyDone} batches, ${s.studentsAlreadyDone} students)`,
    `Timetable (never changed): ${s.timetableClasses} subject classes; ${s.batchesWithTimeOnlySlots} batches with older time-only slots.`,
    `For manual review: ${s.forReview}. Notes (no change): ${s.notes}.`,
    "",
    "Changes:",
    ...(plan.changes.length ? plan.changes.map((c) => `  ${c.ref}  ${c.collection}  program: (none) -> ${c.set.program}  [only if still: ${Object.entries(c.expect).map(([k, v]) => `${k}=${v}`).join(", ")}, no program]`) : ["  none"]),
    "",
    "Manual review (not changed):",
    ...(plan.review.length ? plan.review.map((r) => `  ${r.ref}  ${r.reason}`) : ["  none"]),
    "",
    "Notes (not changed):",
    ...(plan.notes.length ? plan.notes.map((r) => `  ${r.ref}  ${r.reason}`) : ["  none"]),
  ];
  return lines.join("\n");
}

// ─── Database ──────────────────────────────────────────────────────────────

/**
 * The database the app uses: MONGODB_DB, else the one in the URI path, else "pcmb" (as src/lib/db.ts).
 * @param {string | undefined} uri
 * @param {Record<string, string | undefined>} [env]
 */
export function databaseNameFor(uri, env = process.env) {
  const inPath = /^mongodb(\+srv)?:\/\/[^/]+\/([^/?]+)/.exec(uri ?? "");
  return env.MONGODB_DB || (inPath ? inPath[2] : "pcmb");
}

/** True unless the URI points only at this computer. */
export function isRemote(uri) {
  if (/^mongodb\+srv:/.test(uri)) return true;
  const hosts = (/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri ?? "")?.[1] ?? "").split(",");
  return !hosts.every((h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h));
}

const hide = (text) => String(text).replace(/mongodb(\+srv)?:\/\/[^\s'"]+/g, "<database uri>");

function writable(db, name) {
  if (!WRITABLE.has(name)) throw new Error(`refusing to write to ${name}`);
  return db.collection(name);
}

async function snapshot(db) {
  const [batches, users, tuitions, timetable] = await Promise.all([
    db.collection("batches").find({}).toArray(),
    db.collection("users").find({}, { projection: { pushTokens: 0 } }).toArray(),
    db.collection("tuitions").find({}, { projection: { _id: 1 } }).toArray(),
    db.collection("timetableentries").find({}, { projection: { batchId: 1, teacherId: 1, subject: 1, day: 1 } }).toArray(),
  ]);
  return { batches, users, tuitionIds: tuitions.map((t) => t._id), timetable };
}

/**
 * Runs the migration. mode: "dry-run" (default), "apply", "verify" or
 * "rollback". Writes need confirmDb equal to the connected database's name,
 * and allowRemote for anything but a database on this computer.
 * @param {{ uri: string | undefined, dbName?: string, mode?: string, confirmDb?: string, allowRemote?: boolean, refKey?: Buffer, log?: (message: string) => void }} options
 */
export async function runMigration({ uri, dbName, mode = "dry-run", confirmDb, allowRemote = false, refKey, log = console.log }) {
  if (!uri) throw new Error("MONGODB_URI isn't set.");
  const writes = mode === "apply" || mode === "rollback";
  if (!["dry-run", "apply", "verify", "rollback"].includes(mode)) throw new Error(`unknown mode ${mode}`);
  if (writes && isRemote(uri) && !allowRemote) throw new Error(`--${mode} on a remote database needs --allow-remote (and a separate go-ahead).`);
  const name = dbName ?? databaseNameFor(uri);
  if (writes && confirmDb !== name) throw new Error(`--${mode} needs --confirm-db ${name}.`);

  const key = refKey ?? randomBytes(16);
  const ref = (kind, id) => `${kind}-${createHmac("sha256", key).update(String(id)).digest("hex").slice(0, 8)}`;
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 20000, appName: `${MIGRATION_ID}-${mode}` });
  await client.connect();
  try {
    const db = client.db(name);
    const stats = await db.command({ dbStats: 1 });
    if (stats.db !== name || db.databaseName !== name) throw new Error(`connected to ${stats.db}, expected ${name}`);
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    if (!collections.includes("users") || !collections.includes("batches")) throw new Error(`${name} has no users/batches collections; is it the app's database?`);
    log(`Connected to database "${name}" (${stats.collections} collections), mode: ${mode}`);

    if (mode === "dry-run") {
      const plan = planMigration(await snapshot(db), ref);
      return { mode, database: name, plan };
    }

    const records = writable(db, RECORDS);
    if (mode === "apply") {
      const data = await snapshot(db);
      const plan = planMigration(data, ref);
      const docs = new Map([...data.batches, ...data.users].map((d) => [str(d._id), d]));
      const before = { users: await db.collection("users").countDocuments(), batches: await db.collection("batches").countDocuments() };
      const run = { at: new Date(), before, changes: plan.changes.map((c) => ({ collection: c.collection, id: c.id, set: c.set, expect: c.expect, digest: protectedDigest(docs.get(c.id)), modified: 0 })) };
      if (run.changes.length) {
        await records.updateOne(
          { _id: MIGRATION_ID },
          { $setOnInsert: { version: MIGRATION_VERSION, createdAt: new Date() }, $set: { status: "applying" }, $push: { runs: run } },
          { upsert: true }
        );
        for (const c of run.changes) {
          const filter = { _id: new mongoose.mongo.ObjectId(c.id), program: { $exists: false }, ...c.expect };
          const res = await writable(db, c.collection).updateOne(filter, { $set: c.set });
          c.modified = res.modifiedCount;
        }
        await records.updateOne({ _id: MIGRATION_ID }, { $set: { status: "applied", appliedAt: new Date(), [`runs.${(await records.findOne({ _id: MIGRATION_ID })).runs.length - 1}.changes`]: run.changes } });
      }
      log(run.changes.length ? `Set program on ${run.changes.filter((c) => c.modified).length} of ${run.changes.length} planned records.` : "Nothing to change: already applied.");
      return { mode, database: name, plan, modified: run.changes.filter((c) => c.modified).length };
    }

    const record = await records.findOne({ _id: MIGRATION_ID });
    if (!record) return { mode, database: name, ok: mode === "verify" ? false : true, problems: ["this migration was never applied here"], undone: 0 };
    const changed = record.runs.flatMap((r) => r.changes.filter((c) => c.modified));

    if (mode === "verify") {
      const problems = [];
      for (const c of changed) {
        const doc = await db.collection(c.collection).findOne({ _id: new mongoose.mongo.ObjectId(c.id) });
        const label = ref(c.collection === "batches" ? "B" : "S", c.id);
        if (!doc) problems.push(`${label}: missing`);
        else {
          if (record.status !== "rolled-back" && doc.program !== c.set.program) problems.push(`${label}: program is ${doc.program ?? "(none)"}, expected ${c.set.program}`);
          if (protectedDigest(doc) !== c.digest) problems.push(`${label}: a protected field changed since the migration`);
        }
      }
      const first = record.runs[0].before;
      const now = { users: await db.collection("users").countDocuments(), batches: await db.collection("batches").countDocuments() };
      if (now.users < first.users || now.batches < first.batches) problems.push(`fewer records than before the migration (${JSON.stringify(first)} -> ${JSON.stringify(now)})`);
      const pending = planMigration(await snapshot(db), ref).changes.length;
      if (record.status !== "rolled-back" && pending) problems.push(`${pending} records still need the migration (run --apply again)`);
      return { mode, database: name, status: record.status, ok: problems.length === 0, checked: changed.length, problems };
    }

    // rollback: only documents this migration changed, and only while they still hold its value.
    let undone = 0;
    for (const c of changed) {
      const res = await writable(db, c.collection).updateOne({ _id: new mongoose.mongo.ObjectId(c.id), ...c.set }, { $unset: { program: "" } });
      undone += res.modifiedCount;
    }
    await records.updateOne({ _id: MIGRATION_ID }, { $set: { status: "rolled-back", rolledBackAt: new Date() } });
    log(`Removed program from ${undone} records.`);
    return { mode, database: name, undone };
  } finally {
    await client.close();
  }
}

// ─── Command line ──────────────────────────────────────────────────────────

function args(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith("--")) continue;
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[list[i].slice(2)] = true;
    else out[list[i].slice(2)] = list[++i];
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const opts = args(process.argv.slice(2));
  const mode = opts.apply ? "apply" : opts.verify ? "verify" : opts.rollback ? "rollback" : "dry-run";
  // Stable refs across runs on this computer when JWT_SECRET is set (it's never printed).
  const refKey = process.env.JWT_SECRET ? createHash("sha256").update(`${MIGRATION_ID}|${process.env.JWT_SECRET}`).digest() : undefined;
  runMigration({ uri: process.env.MONGODB_URI, dbName: typeof opts.db === "string" ? opts.db : undefined, mode, confirmDb: opts["confirm-db"], allowRemote: !!opts["allow-remote"], refKey })
    .then((result) => {
      if (result.plan) {
        console.log(formatPlan(result.plan));
        if (typeof opts.out === "string") {
          const withoutId = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "id"));
          const anonymous = { ...result.plan, changes: result.plan.changes.map(withoutId), review: result.plan.review.map(withoutId), notes: result.plan.notes.map(withoutId) };
          writeFileSync(opts.out, JSON.stringify({ database: result.database, generatedAt: new Date().toISOString(), ...anonymous }, null, 2));
          console.log(`\nPlan written to ${opts.out}`);
        }
        if (typeof opts.reveal === "string") {
          const refs = Object.fromEntries([...result.plan.changes, ...result.plan.review, ...result.plan.notes].map((x) => [x.ref, x.id]));
          writeFileSync(opts.reveal, JSON.stringify(refs, null, 2));
          console.log(`Ref -> _id map written to ${opts.reveal} (keep it local).`);
        }
      } else console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(`Migration ${mode} failed: ${hide(e?.message ?? e)}`);
      process.exitCode = 1;
    });
}
