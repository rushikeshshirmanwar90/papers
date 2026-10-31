// `npm run dev:local`: the API on this computer against a LOCAL database, for
// trying the app end to end without touching the live (Atlas) data.
//
//   npm run dev:local              -> MongoDB on 127.0.0.1:27027, database pcmb_local
//   npm run dev:local -- --fresh   -> start from an empty local database
//   npm run dev:local -- -p 4000   -> other arguments go to `next dev`
//
// The local database lives in .local-mongo/ (ignored by Git) and keeps its
// data between runs. It has its own login secret and admin key (made on the
// first run, in .local-mongo/secrets.json), so tokens from the live server
// don't work here and the other way round. Email is switched off: sending a
// code fails instead of mailing anyone. Then, with the app's
// EXPO_PUBLIC_API_URL=local (see pcmb-paper/.env.example), the app uses it.
//
// Make a tuition to log in with:
//   ADMIN_API_KEY=<printed key> node scripts/create-tuition.mjs --name "Local Classes" --email owner@local.test --password local-pass-123
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(root, ".local-mongo");
const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const nextArgs = args.filter((a) => a !== "--fresh");
const DB_NAME = "pcmb_local";
const DB_PORT = 27027;

if (fresh) rmSync(join(home, "db"), { recursive: true, force: true });
mkdirSync(join(home, "db"), { recursive: true });

const secretsFile = join(home, "secrets.json");
if (!existsSync(secretsFile)) {
  writeFileSync(secretsFile, JSON.stringify({ jwtSecret: randomBytes(32).toString("hex"), adminApiKey: randomBytes(24).toString("hex") }, null, 2));
}
const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));

const mongod = await MongoMemoryServer.create({ instance: { dbPath: join(home, "db"), storageEngine: "wiredTiger", port: DB_PORT, ip: "127.0.0.1" } });
const uri = mongod.getUri();
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error("The local database isn't on this computer; stopping.");

console.log(`Local database: ${uri}${DB_NAME} (data in .local-mongo/db${fresh ? ", started fresh" : ""})`);
console.log(`Local admin key: ${secrets.adminApiKey}  (for scripts/create-tuition.mjs; local only)`);

const env = {
  ...process.env,
  // Set here, these win over .env.local, so the live database and secrets aren't used.
  MONGODB_URI: uri,
  MONGODB_DB: DB_NAME,
  JWT_SECRET: secrets.jwtSecret,
  ADMIN_API_KEY: secrets.adminApiKey,
  // Email off: a port nothing listens on.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1",
  SMTP_SECURE: "false",
  SMTP_USER: "local-dev-email-off",
  SMTP_PASS: "local-dev-email-off",
};

const child = spawn(process.execPath, [join(root, "scripts", "dev.mjs"), ...nextArgs], { stdio: "inherit", env, cwd: root });
const stop = async (code) => {
  await mongod.stop({ doCleanup: false }).catch(() => {});
  process.exit(code ?? 0);
};
child.on("exit", (code) => void stop(code));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
