// `npm run dev`: runs `next dev` and adds the line Next.js 14 leaves out,
// this computer's address on the network, so a phone on the same Wi-Fi
// (the pcmb-paper app) can reach the API.
//
//   npm run dev              -> Local: http://localhost:3000
//                               Network: http://192.168.x.x:3000
//   npm run dev -- -p 4000   -> extra arguments go to Next
//
// Next already accepts connections from the network. It only prints
// "localhost", unless started with -H, and then it prints 0.0.0.0.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env');

loadEnvConfig(process.cwd(), true);
const demo = process.env.AI_LEARNING_DEMO_ENABLED === 'true';
const args = process.argv.slice(2);
if (demo && args.some(arg => arg === '-H' || arg.startsWith('--hostname'))) {
  throw new Error('Synthetic demos bind to loopback. Disable AI_LEARNING_DEMO_ENABLED for LAN development.');
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

/** This computer's IPv4 addresses on the local network (Wi-Fi, Ethernet). */
function networkAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254."))
    .map((net) => net.address);
}

const child = spawn(process.execPath, [nextBin, "dev", ...args, ...(demo ? ['--hostname', '127.0.0.1'] : [])], {
  stdio: ["inherit", "pipe", "inherit"],
  // Next colours its output only when it writes to a terminal; it now writes to this script.
  env: { ...(process.stdout.isTTY && !("NO_COLOR" in process.env) ? { FORCE_COLOR: '1' } : {}), ...process.env, AI_LEARNING_LOCAL_BOUND: demo ? 'true' : 'false' },
});

// Next's line looks like "  - Local:        http://localhost:3000". The port
// is read from it because Next moves to 3001 and up when 3000 is taken.
const LOCAL_LINE = /Local:\s+(https?):\/\/\S+?:(\d+)/;
const stripColours = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

let networkShown = false;
let partialLine = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (text) => {
  if (networkShown) return void process.stdout.write(text);

  const lines = (partialLine + text).split("\n");
  partialLine = lines.pop();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
    const local = !networkShown && LOCAL_LINE.exec(stripColours(line));
    if (!local) continue;
    networkShown = true;
    const [, protocol, port] = local;
    if (demo) { process.stdout.write('  Synthetic demos enabled: loopback access only.\n'); continue; }
    const addresses = networkAddresses();
    const urls = addresses.length ? addresses.map((ip) => `${protocol}://${ip}:${port}`) : ["(not connected to a network)"];
    for (const url of urls) process.stdout.write(`${line.replace(/Local:.*/, `Network:      ${url}`)}\n`);
  }
  if (networkShown && partialLine) {
    process.stdout.write(partialLine);
    partialLine = "";
  }
});
child.stdout.on("end", () => process.stdout.write(partialLine));

// Pass Ctrl+C and kill on to Next, and finish when it does.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error("Could not start Next.js:", error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
