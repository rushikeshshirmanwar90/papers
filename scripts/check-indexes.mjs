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
const dbName = process.env.MONGODB_DB || "pcmb";

const MB = (b) => (b / 1024 / 1024).toFixed(2);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const allStats = await db.command({ dbStats: 1 });
console.log(`\nDatabase: ${dbName}`);
console.log(`  dataSize:    ${MB(allStats.dataSize)} MB`);
console.log(`  storageSize: ${MB(allStats.storageSize)} MB`);
console.log(`  indexSize:   ${MB(allStats.indexSize)} MB`);
console.log(`  total:       ${MB(allStats.dataSize + allStats.indexSize)} MB\n`);

const qStats = await db.command({ collStats: "questions" });
console.log(`Questions collection (${qStats.count.toLocaleString()} docs):`);
console.log(`  data:    ${MB(qStats.size)} MB`);
console.log(`  storage: ${MB(qStats.storageSize)} MB`);
console.log(`  indexes: ${MB(qStats.totalIndexSize)} MB\n`);

console.log("Index breakdown:");
for (const [name, info] of Object.entries(qStats.indexDetails || {})) {
  const size = (info.storageSize ?? info.size ?? 0);
  console.log(`  ${name.padEnd(35)} ${MB(size)} MB`);
}

await client.close();
