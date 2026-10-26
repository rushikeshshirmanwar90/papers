import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { HttpError } from "@/lib/http";
import type { Role } from "@/lib/school";
import Tuition from "@/models/Tuition";
import User, { type UserDoc } from "@/models/User";

// Logins for the tuition app. Passwords are stored as bcrypt hashes; a login
// returns a signed token (JWT) the app sends as "Authorization: Bearer …".
// Every request re-reads the user, so removing a teacher, disabling a tuition
// or changing a password takes effect at once.

const TOKEN_LIFETIME = "30d";
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    console.error("[auth] JWT_SECRET is missing or shorter than 32 characters");
    throw new HttpError(503, "Logins aren't set up on the server yet.");
  }
  return new TextEncoder().encode(secret);
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);

// Compared against when the email isn't registered, so a wrong email takes as
// long as a wrong password and doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("no-such-user", 10));

export async function signToken(user: Pick<UserDoc, "_id" | "role" | "tuitionId" | "tokenVersion">) {
  return new SignJWT({ role: user.role, tid: String(user.tuitionId), v: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(secretKey());
}

/** Checks the email and password; returns the user, or throws 401 / 429. */
export async function checkLogin(email: string, password: string): Promise<UserDoc> {
  const user = await User.findOne({ email }).select("+passwordHash +failedLogins +lockedUntil");
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    throw new HttpError(401, "Wrong email or password.");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new HttpError(429, `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await User.updateOne(
      { _id: user._id },
      failed >= MAX_FAILED_LOGINS
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { failedLogins: failed }
    );
    throw new HttpError(401, "Wrong email or password.");
  }
  if (!user.active) throw new HttpError(403, "This account has been turned off. Ask your tuition.");
  if (user.pending) throw new HttpError(403, "Your tuition hasn't approved your account yet. Ask them to approve it on their Teachers tab.");
  if (!(await Tuition.exists({ _id: user.tuitionId, active: true }))) {
    throw new HttpError(403, "This tuition's account is turned off.");
  }
  await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() });
  return user;
}

export interface Session {
  user: UserDoc;
  userId: string;
  role: Role;
  tuitionId: string;
}

/**
 * The signed-in user making the request, or a 401. With roles given, anyone
 * else gets a 403.
 */
export async function requireUser(req: NextRequest, ...roles: Role[]): Promise<Session> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Log in to continue.");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Your login has expired. Log in again.");
  }

  const user = payload.sub ? await User.findById(payload.sub) : null;
  if (!user || !user.active || user.pending || user.tokenVersion !== payload.v) {
    throw new HttpError(401, "Your login has expired. Log in again.");
  }
  if (!(await Tuition.exists({ _id: user.tuitionId, active: true }))) {
    throw new HttpError(401, "This tuition's account is turned off.");
  }
  if (roles.length && !roles.includes(user.role)) {
    throw new HttpError(403, "Your account can't do this.");
  }
  return { user, userId: String(user._id), role: user.role, tuitionId: String(user.tuitionId) };
}

/** What the app gets to know about a user. */
export async function publicUser(user: UserDoc) {
  const tuition = await Tuition.findById(user.tuitionId).select("name").lean<{ name: string }>();
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    name: user.name,
    phone: user.phone,
    tuition: { id: String(user.tuitionId), name: tuition?.name ?? "" },
    subjects: user.subjects ?? [],
    track: user.track ?? null,
    standard: user.standard ?? null,
    batchId: user.batchId ? String(user.batchId) : null,
    parentPhone: user.parentPhone ?? "",
  };
}
