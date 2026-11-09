import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { HttpError, isObjectId } from "@/lib/http";
import { programOf, type Role } from "@/lib/school";
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
  if (user.tuitionId && !(await Tuition.exists({ _id: user.tuitionId, active: true }))) {
    throw new HttpError(403, "This tuition's account is turned off.");
  }
  await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() });
  return user;
}

/** A logged-in account, which may not belong to a tuition yet. */
export interface AccountSession {
  user: UserDoc;
  userId: string;
  role: Role | null;
  tuitionId: string | null;
}

/** A member of a tuition: a role and a tuition are guaranteed. */
export interface Session extends AccountSession {
  role: Role;
  tuitionId: string;
}

/**
 * Anyone logged in, including people who registered but haven't joined a
 * tuition yet. Only their own account and join requests use this.
 */
export async function requireAccount(req: NextRequest): Promise<AccountSession> {
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

  // The token names the tuition it was issued for: check it alongside loading the
  // user (one database round trip instead of two). It only counts if it is still
  // the user's tuition; otherwise the user's own tuition is checked as before.
  const tokenTuition = typeof payload.tid === "string" && isObjectId(payload.tid) ? payload.tid : null;
  const [user, tokenTuitionActive] = await Promise.all([
    payload.sub ? User.findById(payload.sub) : null,
    tokenTuition ? Tuition.exists({ _id: tokenTuition, active: true }) : null,
  ]);
  if (!user || !user.active || user.tokenVersion !== payload.v) {
    throw new HttpError(401, "Your login has expired. Log in again.");
  }
  if (user.tuitionId) {
    const active = String(user.tuitionId) === tokenTuition ? !!tokenTuitionActive : !!(await Tuition.exists({ _id: user.tuitionId, active: true }));
    if (!active) throw new HttpError(401, "This tuition's account is turned off.");
  }
  return { user, userId: String(user._id), role: user.role ?? null, tuitionId: user.tuitionId ? String(user.tuitionId) : null };
}

/** Header the app sends to say which workspace a request is made from. */
export const WORKSPACE_HEADER = "x-workspace";

/** The workspaces an account may open: a tuition admin may also open the Teacher one. */
export const workspacesOf = (role: Role | null): Role[] => (role === "tuition" ? ["tuition", "teacher"] : role ? [role] : []);

/**
 * A member of a tuition making the request, or a 401/403. With roles given,
 * anyone else gets a 403.
 *
 * A tuition admin who asks for the Teacher workspace is treated as a teacher for
 * that request: scoped to the batches they teach, with no admin-only routes. The
 * header can only narrow what the account may do; for every other role it is ignored.
 */
export async function requireUser(req: NextRequest, ...roles: Role[]): Promise<Session> {
  const account = await requireAccount(req);
  if (!account.role || !account.tuitionId) throw new HttpError(403, "Join a tuition first.");
  if (account.role === "tuition" && req.headers.get(WORKSPACE_HEADER) === "teacher") account.role = "teacher";
  if (roles.length && !roles.includes(account.role)) throw new HttpError(403, "Your account can't do this.");
  if (account.user.mustChangePassword && account.role === "student") {
    throw new HttpError(403, "Change your password first.");
  }
  return account as Session;
}

/** What the app gets to know about a user. */
export async function publicUser(user: UserDoc) {
  const tuition = user.tuitionId ? await Tuition.findById(user.tuitionId).select("name").lean<{ name: string }>() : null;
  return {
    id: String(user._id),
    email: user.email,
    /** null until a tuition accepts them as a student or teacher. */
    role: user.role ?? null,
    /** The workspaces the account may switch between (the app's selector shows for more than one). */
    workspaces: workspacesOf(user.role ?? null),
    emailVerified: user.emailVerified ?? false,
    name: user.name,
    phone: user.phone,
    tuition: { id: user.tuitionId ? String(user.tuitionId) : "", name: tuition?.name ?? "" },
    subjects: user.subjects ?? [],
    program: programOf(user),
    track: user.track ?? null,
    standard: user.standard ?? null,
    batchId: user.batchId ? String(user.batchId) : null,
    parentPhone: user.parentPhone ?? "",
    mustChangePassword: user.mustChangePassword ?? false,
  };
}
