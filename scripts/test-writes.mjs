import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loadEnv = (file) => {
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
      if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2];
    }
  } catch {}
};
loadEnv(".env");
loadEnv(".env.local");

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db("pcmb");

// Test: can we DELETE a document?
console.log("Testing DELETE...");
try {
  const result = await db.collection("emailcodes").deleteOne({ expiresAt: { $lt: new Date() } });
  console.log("  deleteOne OK: deleted " + result.deletedCount + " docs");
} catch (e) {
  console.log("  deleteOne FAILED: " + e.message.substring(0, 120));
}

// Test: can we INSERT?
console.log("\nTesting INSERT...");
try {
  await db.collection("testattempts").insertOne({ _test: true, at: new Date() });
  console.log("  insertOne OK");
  await db.collection("testattempts").deleteOne({ _test: true });
} catch (e) {
  console.log("  insertOne FAILED: " + e.message.substring(0, 120));
}

// Test: can we UPDATE?
console.log("\nTesting UPDATE...");
try {
  await db.collection("users").updateOne({}, { $set: { _testUpdate: new Date() } });
  console.log("  updateOne OK");
  await db.collection("users").updateOne({}, { $unset: { _testUpdate: "" } });
} catch (e) {
  console.log("  updateOne FAILED: " + e.message.substring(0, 120));
}

// Test: can we DROP a collection?
console.log("\nTesting DROP...");
try {
  await db.collection("temp_storage_test").insertOne({ x: 1 });
  await db.collection("temp_storage_test").drop();
  console.log("  drop OK");
} catch (e) {
  console.log("  drop FAILED: " + e.message.substring(0, 120));
}

// Test: can we drop the pcmb_app database?
console.log("\nTesting DROP DATABASE (pcmb_app)...");
try {
  await client.db("pcmb_app").dropDatabase();
  console.log("  dropDatabase OK (pcmb_app removed)");
} catch (e) {
  console.log("  dropDatabase FAILED: " + e.message.substring(0, 120));
}

await client.close();
