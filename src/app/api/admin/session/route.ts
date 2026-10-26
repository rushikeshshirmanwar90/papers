import { NextResponse } from "next/server";
import { isAdminKey } from "@/lib/admin";
import { ADMIN_COOKIE, ADMIN_SESSION_HOURS, isAdminSession, signAdminSession } from "@/lib/admin-session";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether this browser is logged in to the admin console. */
export const GET = route(async (req) => ({ signedIn: await isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value) }));

/** Logs in with the admin key: { key }. Sets a 12-hour, httpOnly session cookie. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const given = typeof body.key === "string" ? body.key.trim() : "";
  if (!given || !isAdminKey(given)) {
    // Slows down guessing.
    await sleep(800);
    throw new HttpError(401, "That admin key is wrong.");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await signAdminSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_HOURS * 3600,
  });
  return res;
});

/** Logs out of the admin console. */
export const DELETE = route(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
