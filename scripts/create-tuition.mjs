// Creates a tuition and its login, until the Admin web app does this.
//
//   ADMIN_API_KEY=… node scripts/create-tuition.mjs \
//     --server https://papers-jet.vercel.app \
//     --name "Sharma Classes" --email owner@example.com --password "a-strong-password" \
//     [--address "…"] [--phone "…"]
//
//   ADMIN_API_KEY=… node scripts/create-tuition.mjs --server … --list
//
// It calls POST /api/admin/tuitions, the endpoint the Admin app will use, with
// the same key the server has in its ADMIN_API_KEY setting.

function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    if (!key.startsWith("--")) continue;
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[key.slice(2)] = true;
    else out[key.slice(2)] = list[++i];
  }
  return out;
}

const opts = args();
const key = process.env.ADMIN_API_KEY;
const server = String(opts.server ?? "http://localhost:3000").replace(/\/+$/, "");
if (!key) {
  console.error("Set ADMIN_API_KEY to the key the server has.");
  process.exit(1);
}

const url = `${server}/api/admin/tuitions`;
const headers = { "Content-Type": "application/json", "X-Admin-Key": key };

if (opts.list) {
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${body.error}`);
    process.exit(1);
  }
  console.table(body.tuitions.map(({ name, loginEmail, teachers, students, active }) => ({ name, loginEmail, teachers, students, active })));
} else {
  if (!opts.name || !opts.email || !opts.password) {
    console.error('Usage: --name "Tuition name" --email login@example.com --password "at least 8 characters"');
    process.exit(1);
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: opts.name,
      loginEmail: opts.email,
      password: opts.password,
      address: opts.address,
      phone: opts.phone,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${body.error}`);
    process.exit(1);
  }
  console.log(`Created "${body.tuition.name}". It logs in with ${body.login.email} and the password you gave.`);
}
