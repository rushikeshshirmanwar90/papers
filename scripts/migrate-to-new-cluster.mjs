// Copy the whole `pcmb` database from MONGODB_URI (source) to MONGODB_URL2
// (destination), on a different MongoDB Atlas cluster. Used to move everything
// off a cluster whose storage is full onto a freshly created one.
//
// What it copies, per source collection: every document (BSON types — ObjectId,
// Date, Buffer/BinData, Decimal128, etc. — preserved exactly, since the native
// driver round-trips them) and every non-`_id` index (unique, sparse, partial,
// text-with-weights, TTL, collation, … all passed through).
//
// It is resumable and non-destructive:
//   - dry run (no args): reads both clusters, prints what it would do, writes nothing.
//   - --apply --confirm-db pcmb: copies. For each collection:
//       * destination empty          -> copy from the start
//       * destination already full  -> SKIP (up to date)
//       * destination partial        -> RESUME after the highest _id it has
//   - --drop: drop each destination collection first, then copy from the start
//     (clean overwrite; use only to start over).
//
// The copy pages by `_id` with ordered inserts, so on a network error the
// destination's max `_id` is always a clean boundary; we recover it and resume
// just past it — no gaps, no duplicate-key churn, and a re-run picks up exactly
// where the last one stopped. (The source cluster is unstable while its storage
// is full, so this matters.) socketTimeoutMS makes a stalled connection fail
// fast instead of hanging forever.
//
// Run:
//   node --env-file=.env scripts/migrate-to-new-cluster.mjs
//   node --env-file=.env scripts/migrate-to-new-cluster.mjs --apply --confirm-db pcmb
//
// Needs MONGODB_URI (source) and MONGODB_URL2 (destination) in the environment.
// Both Atlas clusters must have this machine's IP in their access list.
import { MongoClient } from "mongodb";

const SRC_URI = process.env.MONGODB_URI;
const DST_URI = process.env.MONGODB_URL2;
if (!SRC_URI) { console.error("Missing MONGODB_URI (source). Set it in .env."); process.exit(2); }
if (!DST_URI) { console.error("Missing MONGODB_URL2 (destination). Set it in .env."); process.exit(2); }

// Mirror src/lib/db.ts: MONGODB_DB, else a name in the connection-string path,
// else "pcmb". Both our URIs have no path, so this is "pcmb" for both clusters.
function dbNameFor(uri) {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  const m = /^mongodb(\+srv)?:\/\/[^/]+\/([^/?]+)/.exec(uri ?? "");
  return m ? decodeURIComponent(m[2]) : "pcmb";
}
const SRC_DB = dbNameFor(SRC_URI);
const DST_DB = SRC_DB; // same database name on the new cluster

const args = new Set(process.argv.slice(2));
const opt = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && !process.argv[i + 1]?.startsWith("--") ? process.argv[i + 1] : undefined;
};
const APPLY = args.has("--apply");
const DROP = args.has("--drop");
const CONFIRM_DB = opt("confirm-db");

const say = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = (name) => (name === "storedfiles" ? 50 : 1000); // storedfiles holds PDF/diagram Buffers

const CLIENT_OPTS = {
  serverSelectionTimeoutMS: 20000, // give up finding a server fast, then we retry
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000, // a stalled read/write errors instead of hanging forever
  heartbeatFrequencyMS: 10000,
};
const srcClient = new MongoClient(SRC_URI, CLIENT_OPTS);
const dstClient = new MongoClient(DST_URI, CLIENT_OPTS);

// Index options the native driver accepts on createIndex. Everything else
// in an index spec (`v`, `ns`) is metadata we must not pass back.
const IDX_OPTS = [
  "unique", "sparse", "partialFilterExpression", "weights", "default_language",
  "language_override", "textIndexVersion", "expireAfterSeconds", "collation",
  "2dsphereIndexVersion", "bitsBucket", "wildcardProjection", "hidden",
];

async function listUserCollections(db) {
  const all = await db.listCollections({}, { nameOnly: true }).toArray();
  return all.filter((c) => !c.name.startsWith("system.")).map((c) => c.name).sort();
}

async function maxId(coll) {
  const hi = await coll.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
  return hi ? hi._id : null;
}

async function copyCollection(srcDb, dstDb, name) {
  const srcColl = srcDb.collection(name);
  const dstColl = dstDb.collection(name);

  const srcCount = await srcColl.countDocuments();
  const dstNames = new Set(await listUserCollections(dstDb));
  const dstExists = dstNames.has(name);
  let dstCount = 0;
  if (dstExists) dstCount = await dstColl.countDocuments();

  if (!APPLY) {
    let note = "";
    if (dstExists && dstCount > 0) note = dstCount === srcCount ? "  [up to date]" : `  [partial ${dstCount}/${srcCount}; will RESUME]`;
    say(`  ${name.padEnd(22)} src=${String(srcCount).padStart(7)}  dst=${dstExists ? dstCount : "-"}  idx=(see src)${note}`);
    return { srcCount, dstCount, copied: 0, indexes: 0, skipped: false };
  }

  // Decide: drop & recopy / skip (already complete) / resume (partial) / copy (empty).
  let lastId = null;
  let skipCopy = false;
  if (DROP) {
    if (dstExists) await dstColl.drop();
  } else if (dstCount === srcCount) {
    skipCopy = true;
  } else if (dstCount > 0) {
    lastId = await maxId(dstColl); // resume just past the highest _id already there
  }

  let copied = dstCount;
  if (!skipCopy) {
    say(`  ${name.padEnd(22)} ${lastId ? `resume ${dstCount}/${srcCount} ->` : "copying"} ${srcCount}...`);
    // Copy page-by-page ordered by _id (uses the _id_ index) with ordered
    // inserts. On any error we recompute lastId from the destination's max _id
    // (the true high-water mark, since ordered inserts write a clean prefix)
    // and resume just past it: no gaps, no duplicate-key churn. BSON types
    // round-trip driver <-> driver.
    const batch = BATCH(name);
    let attempts = 0;
    let pages = 0;
    let done = false;
    while (!done) {
      try {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const page = await srcColl.find(filter).sort({ _id: 1 }).limit(batch).toArray();
        if (page.length === 0) { done = true; break; }
        await dstColl.insertMany(page, { ordered: true }); // prefix-safe on error
        lastId = page[page.length - 1]._id;
        copied += page.length;
        attempts = 0;
        pages++;
        if (srcCount > 5000 && pages % 20 === 0) say(`    ...page ${pages}, ${copied}/${srcCount}`);
        if (page.length < batch) done = true; // final (short) page
      } catch (e) {
        attempts++;
        if (attempts > 40) throw e;
        // Recover the actual high-water mark on the destination. If that lookup
        // itself fails (e.g. a transient DNS blip on the destination cluster),
        // keep the old lastId and just back off — the next iteration retries,
        // and once the read or the prefix-dup resolves we advance. No call in
        // here is allowed to escape: this handler must always return to the loop.
        try { lastId = await maxId(dstColl); } catch { /* keep lastId; retry */ }
        const wait = Math.min(2000 * 2 ** Math.min(attempts - 1, 4), 10000);
        say(`    ! error (${e.message}); retry ${attempts}/40 in ${wait}ms, ${copied} written so far`);
        await sleep(wait);
      }
    }
  } else {
    say(`  ${name.padEnd(22)} SKIP - up to date (${dstCount})`);
  }

  // Recreate every non-_id index from the source (idempotent; run for copied
  // and skipped-already-complete collections alike so a re-run fixes any missing).
  let indexCount = 0;
  const indexes = await srcColl.indexes();
  for (const idx of indexes) {
    if (idx.name === "_id_") continue;
    const opts = { name: idx.name };
    for (const k of IDX_OPTS) if (k in idx) opts[k] = idx[k];
    try {
      await dstColl.createIndex(idx.key, opts);
      indexCount++;
    } catch (e) {
      say(`    ! index ${name}.${idx.name}: ${e.message}`);
    }
  }

  const got = await dstColl.countDocuments();
  say(`    indexes ${indexCount}, dst now ${got}${got === srcCount ? "" : "  !! COUNT MISMATCH"}`);
  return { srcCount, dstCount: got, copied, indexes: indexCount, skipped: skipCopy };
}

let exitCode = 0;
try {
  await srcClient.connect();
  await dstClient.connect();
  const srcDb = srcClient.db(SRC_DB);
  const dstDb = dstClient.db(DST_DB);

  const srcInfo = await srcDb.command({ buildInfo: 1 });
  const dstInfo = await dstDb.command({ buildInfo: 1 });
  say(`source:      ${SRC_URI.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@")}  db="${srcDb.databaseName}"  mongo ${srcInfo.version}`);
  say(`destination: ${DST_URI.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@")}  db="${dstDb.databaseName}"  mongo ${dstInfo.version}`);
  say(APPLY
    ? `\nMODE: ${DROP ? "APPLY (--drop: clean overwrite)" : "APPLY (skip done; resume partial)"}${CONFIRM_DB ? "" : "  !! no --confirm-db"}`
    : "\nMODE: DRY RUN (writes nothing)");

  if (APPLY && CONFIRM_DB !== srcDb.databaseName) {
    throw new Error(`Pass --confirm-db ${srcDb.databaseName} to write.`);
  }

  const names = await listUserCollections(srcDb);
  say(`\n${names.length} collection(s) on source:\n`);

  let totalSrc = 0, totalCopied = 0, skipped = 0, mismatches = 0;
  for (const name of names) {
    const r = await copyCollection(srcDb, dstDb, name);
    totalSrc += r.srcCount;
    if (!r.skipped) totalCopied += r.copied;
    if (r.skipped) skipped++;
    if (APPLY && !r.skipped && r.dstCount !== r.srcCount) mismatches++;
  }

  if (!APPLY) {
    say(`\nDRY RUN: ${names.length} collections, ${totalSrc} documents on source.`);
    say("Re-run with --apply --confirm-db pcmb [--drop] to copy.");
  } else {
    // Final verification: recount every collection on both sides.
    say("\nverifying...");
    let bad = 0;
    for (const name of names) {
      const s = await srcDb.collection(name).countDocuments();
      const d = await dstDb.collection(name).countDocuments();
      if (s !== d) { say(`  X ${name}: src ${s} != dst ${d}`); bad++; }
    }
    say(`\ndone: ${totalCopied} documents written${skipped ? `, ${skipped} collection(s) already up to date` : ""}.`);
    if (bad || mismatches) { say(`!! ${bad + mismatches} count mismatch(es).`); exitCode = 1; }
    else say("all counts match");
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await srcClient.close().catch(() => {});
  await dstClient.close().catch(() => {});
}
process.exit(exitCode);
