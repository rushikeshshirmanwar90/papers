import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";

// Helpers shared by the JSON API routes of the tuition app (logins, batches,
// teachers, students…): one error type, one way to read a body and one
// wrapper that turns errors into JSON responses.

/** An error the client caused or should see: its message goes back as `error`. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (what = "This") => new HttpError(404, `${what} was not found.`);

/** The request body as a JSON object; anything else is a 400. */
export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Send the details as JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Send the details as a JSON object.");
  return body as Record<string, unknown>;
}

type Handler<C> = (req: NextRequest, context: C) => Promise<unknown>;

/**
 * Connects to the database, runs the handler and answers with its result as
 * JSON. An HttpError becomes its status and message; anything else is logged
 * and answered with a plain 500, so internals never reach the client.
 */
export function route<C = unknown>(handler: Handler<C>) {
  return async (req: NextRequest, context: C) => {
    try {
      await connectDB();
      const result = await handler(req, context);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
      // Mongo's duplicate-key error, e.g. an email that's already registered.
      const mongoError = error as { code?: number; keyPattern?: Record<string, unknown> };
      if (mongoError?.code === 11000) {
        const message = mongoError.keyPattern?.email ? "An account with this email already exists." : "That already exists.";
        return NextResponse.json({ error: message }, { status: 409 });
      }
      console.error(`[${req.method} ${req.nextUrl.pathname}]`, error);
      return NextResponse.json({ error: "Something went wrong on the server. Try again." }, { status: 500 });
    }
  };
}

// ─── Field readers: each returns a clean value or throws a 400 ─────────────

export function text(body: Record<string, unknown>, field: string, opts: { required?: boolean; max?: number; label?: string } = {}) {
  const { required = false, max = 200, label = field } = opts;
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`Enter ${label}.`);
    return undefined;
  }
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`Enter ${label}.`);
  if (trimmed.length > max) throw badRequest(`${label} is too long (at most ${max} characters).`);
  return trimmed;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(body: Record<string, unknown>, field = "email") {
  const value = text(body, field, { required: true, max: 200, label: "an email address" })!.toLowerCase();
  if (!EMAIL_RE.test(value)) throw badRequest("Enter a valid email address.");
  return value;
}

export const MIN_PASSWORD = 8;

export function password(body: Record<string, unknown>, field = "password") {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) throw badRequest("Enter a password.");
  if (value.length < MIN_PASSWORD) throw badRequest(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (value.length > 200) throw badRequest("The password is too long.");
  return value;
}

export function oneOf<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[], label = field): T {
  const value = body[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badRequest(`Choose ${label}: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function listOf<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[], label = field): T[] {
  const value = body[field] ?? [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !allowed.includes(v as T))) {
    throw badRequest(`${label} must be from: ${allowed.join(", ")}.`);
  }
  return [...new Set(value as T[])];
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;
export const isObjectId = (value: unknown): value is string => typeof value === "string" && OBJECT_ID.test(value);

export function objectId(value: unknown, label = "id") {
  if (!isObjectId(value)) throw badRequest(`${label} is not valid.`);
  return value;
}
