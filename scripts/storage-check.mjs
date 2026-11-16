// Shows every collection's size and document count, and which ones can be
// safely cleaned up to free Atlas free-tier storage (512 MB).
//
//   node scripts/storage-check.mjs           — show sizes (read-only)
//   node scripts/storage-check.mjs --clean   — also delete expired/old data
//
// Connects directly to MongoDB using the MONGODB_URI from .env / .env.local.

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env then .env.local (same precedence as Next.js).
const loadEnv = (file) => {
  try {
    const text = readFileSync(resolve(root, file), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
      if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2];
    }
  } catch {}
};
loadEnv(".env");
loadEnv(".env.local");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || (/^mongodb(\+srv)?:\/\/[^/]+\/([^/?]+)/.test(uri ?? "") ? uri.match(/\/([^/?]+)\??/)[1] : "pcmb");

if (!uri) {
  console.error("MONGODB_URI not found. Set it in .env or .env.local.");
  process.exit(1);
}

const CLEAN = process.argv.includes("--clean");
const MB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`\nDatabase: ${dbName}`);
  console.log(`${"=".repeat(70)}\n`);

  // ── Total database stats ──
  const stats = await db.command({ dbStats: 1 });
  console.log(`Total data:     ${MB(stats.dataSize)} MB`);
  console.log(`Total storage:  ${MB(stats.storageSize)} MB (includes WiredTiger overhead)`);
  console.log(`Atlas limit:    512 MB`);
  console.log(`                ${(stats.dataSize / 512 / 1024 / 1024 * 100).toFixed(1)}% full (by dataSize)`);
  if (stats.dataSize > 512 * 1024 * 1024) {
    console.log(`                ⚠  OVER LIMIT — writes may be blocked.\n`);
  } else {
    console.log(`                ${(512 - stats.dataSize / 1024 / 1024).toFixed(2)} MB free\n`);
  }

  // ── Per-collection stats ──
  const collections = await db.listCollections().toArray();
  const rows = [];

  for (const col of collections) {
    const name = col.name;
    const count = await db.collection(name).countDocuments();
    const colStats = await db.command({ collStats: name });
    rows.push({ name, count, sizeMB: MB(colStats.size), storageMB: MB(colStats.storageSize), avgBytes: count > 0 ? Math.round(colStats.size / count) : 0 });
  }

  rows.sort((a, b) => parseFloat(b.sizeMB) - parseFloat(a.sizeMB));

  console.log(`${"Collection".padEnd(30)} ${"Docs".padStart(10)} ${"Data MB".padStart(10)} ${"Storage MB".padStart(12)} ${"Avg/doc".padStart(8)}`);
  console.log(`${"-".repeat(70)}`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(30)} ${r.count.toLocaleString().padStart(10)} ${r.sizeMB.padStart(10)} ${r.storageMB.padStart(12)} ${r.avgBytes.toLocaleString().padStart(8)}`);
  }
  console.log(`${"-".repeat(70)}\n`);

  // ── Orphaned collections (no model in src/models/) ──
  console.log(`${"=".repeat(70)}`);
  console.log("Orphaned collections (no model in src/models/, safe to drop):\n");

  const modelNames = new Set([
    "announcements", "attempts", "batchinvites", "batches", "chapterweightages",
    "dailyactivities", "emailcodes", "institutelogos", "joinrequests",
    "notificationlogs", "papers", "paper", "practiceanswers", "questions",
    "selfassessments", "storedfiles", "studentengagements", "students",
    "syllabusprogresses", "testattempts", "testrooms", "textbooks",
    "timetableentries", "tuitions", "users", "xpevents",
  ]);

  const orphaned = rows.filter((r) => !modelNames.has(r.name.toLowerCase()));
  if (orphaned.length === 0) {
    console.log("  None found.\n");
  } else {
    for (const r of orphaned) {
      console.log(`  ${r.name.padEnd(30)} ${r.count.toLocaleString().padStart(8)} docs  ${r.sizeMB} MB`);
    }
    if (CLEAN) {
      console.log("\n  Dropping orphaned collections...\n");
      for (const r of orphaned) {
        await db.collection(r.name).drop().catch(() => {});
        console.log(`  ✓ Dropped ${r.name} (freed ${r.sizeMB} MB)`);
      }
    } else {
      console.log("\n  Run with --clean to drop these.\n");
    }
  }

  // ── Safe cleanup candidates ──
  console.log(`${"=".repeat(70)}`);
  console.log("Safe to clean up (expired / old data):\n");

  const candidates = [];

  try {
    const expiredCodes = await db.collection("emailcodes").countDocuments({ expiresAt: { $lt: new Date() } });
    if (expiredCodes > 0) candidates.push({ name: "emailcodes (expired)", count: expiredCodes, clean: async () => db.collection("emailcodes").deleteMany({ expiresAt: { $lt: new Date() } }) });
  } catch {}

  try {
    const oldNotifs = await db.collection("notificationlogs").countDocuments({ sentAt: { $lt: new Date(Date.now() - 3 * 86400000) } });
    if (oldNotifs > 0) candidates.push({ name: "notificationlogs (older than 3 days)", count: oldNotifs, clean: async () => db.collection("notificationlogs").deleteMany({ sentAt: { $lt: new Date(Date.now() - 3 * 86400000) } }) });
  } catch {}

  try {
    const oldActivity = await db.collection("dailyactivities").countDocuments({ firstAt: { $lt: new Date(Date.now() - 180 * 86400000) } });
    if (oldActivity > 0) candidates.push({ name: "dailyactivities (older than 6 months)", count: oldActivity, clean: async () => db.collection("dailyactivities").deleteMany({ firstAt: { $lt: new Date(Date.now() - 180 * 86400000) } }) });
  } catch {}

  try {
    const oldXp = await db.collection("xpevents").countDocuments({ at: { $lt: new Date(Date.now() - 180 * 86400000) } });
    if (oldXp > 0) candidates.push({ name: "xpevents (older than 6 months)", count: oldXp, clean: async () => db.collection("xpevents").deleteMany({ at: { $lt: new Date(Date.now() - 180 * 86400000) } }) });
  } catch {}

  if (candidates.length === 0) {
    console.log("  No expired or orphaned data found.\n");
  } else {
    for (const c of candidates) {
      console.log(`  ${c.name.padEnd(45)} ${c.count.toLocaleString().padStart(8)} docs`);
    }
    if (CLEAN) {
      console.log("\n  Cleaning up...\n");
      for (const c of candidates) {
        const result = await c.clean();
        console.log(`  ✓ Deleted ${result.deletedCount.toLocaleString()} from ${c.name}`);
      }
      console.log("");
    } else {
      console.log("\n  Run with --clean to delete the above.\n");
    }
  }

  // ── Top papers by question count ──
  console.log(`${"=".repeat(70)}`);
  console.log("Largest papers by question count (delete old ones to free the most space):\n");

  try {
    const papers = await db.collection("papers").aggregate([
      { $lookup: { from: "questions", localField: "_id", foreignField: "paperId", as: "qs" } },
      { $project: { title: 1, year: 1, examType: 1, uploadedDate: 1, questionCount: { $size: "$qs" } } },
      { $sort: { questionCount: -1 } },
      { $limit: 15 },
    ]).toArray();

    if (papers.length === 0) {
      console.log("  No papers found.\n");
    } else {
      console.log(`${"Title".padEnd(50)} ${"Questions".padStart(10)}  ${"Year".padStart(6)}`);
      console.log(`${"-".repeat(70)}`);
      for (const p of papers) {
        const title = (p.title || "Untitled").substring(0, 48);
        console.log(`${title.padEnd(50)} ${p.questionCount.toLocaleString().padStart(10)}  ${String(p.year ?? "").padStart(6)}`);
      }
      console.log(`\n  To delete a paper and its questions: DELETE /api/papers/<_id>`);
      console.log(`  Or use the Papers page at /papers in the web app.\n`);
    }
  } catch {}

  // ── Summary ──
  console.log(`${"=".repeat(70)}`);
  console.log("Summary:\n");
  console.log(`  The questions collection holds ${rows.find(r => r.name === "questions")?.count.toLocaleString() ?? "many"} questions`);
  console.log(`  (${rows.find(r => r.name === "questions")?.sizeMB ?? "many"} MB — the bulk of storage).`);
  console.log(`  Deleting old papers removes their questions, freeing the most space.`);
  console.log(`  Or upgrade Atlas: M0 free (512 MB) → M2 ($0.08/hr, 2 GB).\n`);

  if (CLEAN) {
    console.log("Re-run without --clean to see the updated sizes.\n");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
