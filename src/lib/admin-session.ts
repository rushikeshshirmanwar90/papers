import { SignJWT, jwtVerify } from "jose";

// The admin console's login: a signed cookie, set after the admin key is
// entered. Kept free of database code so the middleware (edge) can use it.

export const ADMIN_COOKIE = "pcmb_admin";
export const ADMIN_SESSION_HOURS = 12;

function key(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}

export async function signAdminSession(): Promise<string> {
  const k = key();
  if (!k) throw new Error("JWT_SECRET is missing or too short");
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("pcmb-admin")
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_HOURS}h`)
    .sign(k);
}

/** Whether the cookie holds a valid, unexpired admin session. */
export async function isAdminSession(token: string | undefined): Promise<boolean> {
  const k = key();
  if (!token || !k) return false;
  try {
    const { payload } = await jwtVerify(token, k, { algorithms: ["HS256"], audience: "pcmb-admin" });
    return payload.role === "admin";
  } catch {
    return false;
  }
}
