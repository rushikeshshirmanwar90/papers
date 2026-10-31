import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";
import type { Types } from "mongoose";
import { HttpError } from "@/lib/http";
import { formatCode, newCode, normaliseCode, tuitionByCode } from "@/lib/join-code";
import { isOffered, notOffered, programOf, type Program, type SchoolStandard } from "@/lib/school";
import Batch, { type BatchDoc } from "@/models/Batch";
import BatchInvite, { type BatchInviteDoc } from "@/models/BatchInvite";
import { type JoinRequestDoc } from "@/models/JoinRequest";
import Tuition, { type TuitionDoc } from "@/models/Tuition";
import User from "@/models/User";

// Joining codes for batches. A student who has registered enters one to ask
// to join exactly that batch of exactly that tuition; the tuition approves.
// A code can't carry a role: it only ever leads to a student request.

export const DEFAULT_EXPIRY_DAYS = 180;
const MAX_EXPIRY_DAYS = 365;
const MAX_CODE_FAILURES = 10;
const LOCK_MINUTES = 15;

// ─── Keeping codes: a keyed hash to find them, ciphertext to show them again ─

function keys() {
  const secret = process.env.JOIN_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, "Joining codes aren't set up on the server yet.");
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, "batch-invite", info, 32));
  return { mac: derive("mac"), enc: derive("enc") };
}

export const hashCode = (code: string) => createHmac("sha256", keys().mac).update(code).digest("hex");

function seal(code: string, batchId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys().enc, iv);
  cipher.setAAD(Buffer.from(batchId));
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function unseal(sealed: string, batchId: string): string | null {
  const { enc } = keys(); // a missing secret is a 503, not an unreadable code
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", enc, iv);
    decipher.setAAD(Buffer.from(batchId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ─── Making, reading and changing a batch's code ───────────────────────────

const daysFromNow = (days: number | null) => (days === null ? null : new Date(Date.now() + days * 86_400_000));

/** Days from a request body: 1–365, or null for no expiry; absent means the default. */
export function readExpiryDays(body: Record<string, unknown>): number | null {
  if (body.expiresInDays === undefined) return DEFAULT_EXPIRY_DAYS;
  if (body.expiresInDays === null) return null;
  const days = body.expiresInDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new HttpError(400, `Choose an expiry of 1 to ${MAX_EXPIRY_DAYS} days, or none.`);
  }
  return days;
}

/** Why this batch can't take a code, or null. */
export function inviteProblem(batch: BatchDoc): string | null {
  if (!batch.active) return "This batch is turned off.";
  // Older batches may have no class; students would join without one.
  if (!batch.standard) return "Set this batch's class (11th or 12th) before students join it.";
  const program = programOf(batch);
  return program && !isOffered(program) ? notOffered(program) : null;
}

/** Puts a new code on the invite (replacing the old one), retrying on the rare clash. */
async function putNewCode(invite: BatchInviteDoc, days: number | null) {
  for (let tries = 0; tries < 8; tries++) {
    const code = newCode();
    invite.codeHash = hashCode(code);
    invite.codeCipher = seal(code, String(invite.batchId));
    invite.status = "active";
    invite.expiresAt = daysFromNow(days);
    invite.rotatedAt = new Date();
    invite.revokedAt = null;
    try {
      await invite.save();
      return code;
    } catch (error) {
      // 11000 on the code's hash: another batch has that code; try another.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new HttpError(500, "Couldn't make a unique joining code. Try again.");
}

/** The batch's invite, made on first use. */
export async function inviteOf(batch: BatchDoc, adminId: Types.ObjectId): Promise<BatchInviteDoc> {
  const found = (await BatchInvite.findOne({ batchId: batch._id })) as BatchInviteDoc | null;
  if (found) return found;
  const invite = new BatchInvite({ tuitionId: batch.tuitionId, batchId: batch._id, createdBy: adminId });
  try {
    await putNewCode(invite, DEFAULT_EXPIRY_DAYS);
    return invite;
  } catch (error) {
    // Two admins opened it at once; use whichever was saved.
    const other = (await BatchInvite.findOne({ batchId: batch._id })) as BatchInviteDoc | null;
    if (other) return other;
    throw error;
  }
}

export type InviteAction = "regenerate" | "revoke" | "extend";

export async function changeInvite(batch: BatchDoc, adminId: Types.ObjectId, action: InviteAction, days: number | null) {
  const invite = await inviteOf(batch, adminId);
  if (action === "regenerate") {
    await putNewCode(invite, days);
  } else if (action === "revoke") {
    await BatchInvite.updateOne({ _id: invite._id }, { $set: { status: "revoked", revokedAt: new Date() }, $unset: { codeHash: "", codeCipher: "" } });
  } else {
    if (invite.status !== "active") throw new HttpError(409, "This code is turned off. Make a new one instead.");
    await BatchInvite.updateOne({ _id: invite._id }, { expiresAt: daysFromNow(days) });
  }
  return (await BatchInvite.findById(invite._id)) as BatchInviteDoc;
}

/** What the tuition's app shows about a batch's code. */
export async function inviteOut(invite: BatchInviteDoc, batch: BatchDoc) {
  const tuition = await Tuition.findById(batch.tuitionId).select("name").lean<{ name: string }>();
  // A code that can't be read any more (the server's secret changed) is never
  // replaced here: that would silently end the code already handed out. The
  // tuition sees no code and chooses Regenerate.
  const code = invite.status === "active" && invite.codeCipher ? unseal(invite.codeCipher, String(batch._id)) : null;
  const expired = !!invite.expiresAt && invite.expiresAt <= new Date();
  return {
    status: invite.status === "revoked" ? "revoked" : expired ? "expired" : "active",
    code: code ? formatCode(code) : null,
    expiresAt: invite.expiresAt,
    institute: tuition?.name ?? "",
    batch: { id: String(batch._id), name: batch.name, program: programOf(batch), standard: (batch.standard ?? null) as SchoolStandard | null },
  };
}

// ─── Using a code ──────────────────────────────────────────────────────────

export type ResolvedCode = { kind: "batch"; tuition: TuitionDoc; batch: BatchDoc } | { kind: "tuition"; tuition: TuitionDoc };

/** The owner's push for a new join request. A batch request opens People › Students; a legacy institute request stays on Home. */
export function joinRequestPush(resolved: ResolvedCode, studentName: string) {
  return resolved.kind === "batch"
    ? {
        title: "Someone wants to join",
        body: `${studentName} asked to join ${resolved.batch.name}. Approve them under People › Students.`,
        data: { tab: "people", kind: "batch-enrollment" },
      }
    : {
        title: "Someone wants to join",
        body: `${studentName} asked to join ${resolved.tuition.name}. Accept them as a student or teacher on your Home tab.`,
        data: { tab: "home", kind: "join-request" },
      };
}

export const INVALID_CODE = "That code isn't valid, or it has expired. Check it with your tuition.";

/**
 * The tuition and batch a code leads to, or null. A batch's code only works
 * while it's active and unexpired and its batch and tuition are active. Codes
 * of the older kind (a tuition's own) still resolve, to the tuition alone.
 */
export async function resolveCode(value: unknown): Promise<ResolvedCode | null> {
  const code = normaliseCode(value);
  if (code.length !== 8) return null;
  const invite = (await BatchInvite.findOne({ codeHash: hashCode(code), status: "active" })) as BatchInviteDoc | null;
  if (invite) {
    if (invite.expiresAt && invite.expiresAt <= new Date()) return null;
    const [batch, tuition] = await Promise.all([
      Batch.findOne({ _id: invite.batchId, tuitionId: invite.tuitionId, active: true }) as Promise<BatchDoc | null>,
      Tuition.findOne({ _id: invite.tuitionId, active: true }) as Promise<TuitionDoc | null>,
    ]);
    return batch && tuition && !inviteProblem(batch) ? { kind: "batch", tuition, batch } : null;
  }
  const tuition = await tuitionByCode(code);
  return tuition ? { kind: "tuition", tuition } : null;
}

/** Throws a 429 while this person is locked out of entering codes. */
async function mustNotBeLocked(userId: Types.ObjectId) {
  const row = await User.findById(userId).select("+joinCodeLockedUntil").lean<{ joinCodeLockedUntil?: Date | null }>();
  const until = row?.joinCodeLockedUntil;
  if (until && until > new Date()) {
    const minutes = Math.ceil((until.getTime() - Date.now()) / 60000);
    throw new HttpError(429, `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
}

/** Counts a wrong code; after too many in a row, locks code entry for a while. */
async function noteWrongCode(userId: Types.ObjectId) {
  const row = await User.findByIdAndUpdate(userId, { $inc: { joinCodeFailures: 1 } }, { new: true })
    .select("+joinCodeFailures")
    .lean<{ joinCodeFailures: number }>();
  if (row && row.joinCodeFailures >= MAX_CODE_FAILURES) {
    await User.updateOne({ _id: userId }, { joinCodeFailures: 0, joinCodeLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) });
  }
  // Slows down guessing even before the lock.
  await new Promise((r) => setTimeout(r, 400));
}

/** Checks the code for this person, counting a wrong one; throws a 404 or 429. */
export async function resolveForPerson(userId: Types.ObjectId, value: unknown): Promise<ResolvedCode> {
  await mustNotBeLocked(userId);
  const resolved = await resolveCode(value);
  if (!resolved) {
    await noteWrongCode(userId);
    throw new HttpError(404, INVALID_CODE);
  }
  await User.updateOne({ _id: userId, joinCodeFailures: { $gt: 0 } }, { joinCodeFailures: 0 });
  return resolved;
}

/** What a student may see of a code's batch before asking to join: names only. */
export function previewOf(resolved: ResolvedCode) {
  const batch = resolved.kind === "batch" ? resolved.batch : null;
  const program: Program | null = batch ? programOf(batch) : null;
  return {
    kind: resolved.kind,
    institute: resolved.tuition.name,
    batch: batch ? { name: batch.name, program, standard: batch.standard ?? null } : null,
  };
}

/** A person's own join request as the app shows it: the institute, and the batch when it came with a batch's code. */
export async function myRequestOut(request: JoinRequestDoc) {
  const [tuition, batch] = await Promise.all([
    Tuition.findById(request.tuitionId).select("name address").lean<{ name: string; address: string }>(),
    request.batchId ? Batch.findById(request.batchId).select("name program track standard").lean<Pick<BatchDoc, "name" | "program" | "track" | "standard">>() : null,
  ]);
  return {
    id: String(request._id),
    status: request.status,
    acceptedAs: request.acceptedAs,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
    tuition: { name: tuition?.name ?? "", address: tuition?.address ?? "" },
    batch: batch ? { name: batch.name, program: programOf(batch), standard: batch.standard ?? null } : null,
  };
}
