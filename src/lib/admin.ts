import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/admin-session";
import { HttpError } from "@/lib/http";

// Who may use /api/admin: the admin console (session cookie) or a script
// with the X-Admin-Key header (scripts/create-tuition.mjs).

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether the given key is the server's ADMIN_API_KEY (compared in constant time). */
export function isAdminKey(given: string): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 24) throw new HttpError(503, "Admin access isn't set up on the server (ADMIN_API_KEY).");
  return timingSafeEqual(digest(given), digest(expected));
}

export async function requireAdmin(req: NextRequest) {
  const header = req.headers.get("x-admin-key");
  if (header !== null) {
    if (!isAdminKey(header)) throw new HttpError(401, "Wrong admin key.");
    return;
  }
  if (!(await isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value))) {
    throw new HttpError(401, "Log in to the admin console again.");
  }
  // A cookie is sent by the browser on its own: changes must come from this site.
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) throw new HttpError(403, "That request didn't come from the admin console.");
  }
}
