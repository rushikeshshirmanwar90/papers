import type { ClientSession } from 'mongoose';
import { HttpError } from '@/lib/http';
import { deadlineOf, finalizeLocked } from '@/lib/attempts';
import { withTestLock } from '@/lib/test-lock';
import TestAttempt, { type TestAttemptDoc } from '@/models/TestAttempt';
import type { TestRoomDoc } from '@/models/TestRoom';

import { VISIBILITY_GRACE_MS } from '@/lib/exam-visibility-policy';
export { VISIBILITY_GRACE_MS } from '@/lib/exam-visibility-policy';
const REASONS = ['app-background', 'app-inactive', 'focus-loss', 'screen-focus-loss', 'split-screen', 'visibility-unconfirmed'];
type Interruption = { id: string; reason: string; startedAt: Date; returnedAt: Date | null };
const revOf = (attempt: TestAttemptDoc) => (attempt.rev ?? 0) === 0 ? { $in: [0, null] } : attempt.rev;

async function suspend(test: TestRoomDoc, attempt: TestAttemptDoc, session: ClientSession, interruption: Interruption, now: Date) {
  const stopAt = new Date(interruption.startedAt.getTime() + VISIBILITY_GRACE_MS);
  const deadline = deadlineOf(test, attempt);
  // Normal expiry wins if there was no examination time left at the end of
  // the grace period. Never reinterpret a historical submission as a pause.
  if (attempt.submittedAt || attempt.suspendedAt || test.manuallyEndedAt || stopAt >= deadline) return attempt;
  return await TestAttempt.findOneAndUpdate({ _id: attempt._id, submittedAt: null, suspendedAt: null, rev: revOf(attempt) }, {
    $set: { suspendedAt: stopAt, remainingMs: deadline.getTime() - stopAt.getTime(), endedReason: 'violation' },
    $inc: { rev: 1 },
    $push: { events: { type: 'away', at: now, ended: true, awayMs: Math.max(0, (interruption.returnedAt ?? now).getTime() - interruption.startedAt.getTime()),
      interruptionId: interruption.id, reason: interruption.reason, startedAt: interruption.startedAt, returnedAt: interruption.returnedAt } },
  }, { returnDocument: 'after', session }) as TestAttemptDoc;
}

/** Called under the existing room transaction before expiry, saving, teacher
 * controls and result release. No JS timer or background worker is required. */
export async function reconcileVisibilityLocked(test: TestRoomDoc, attempt: TestAttemptDoc, session: ClientSession, now = new Date()) {
  if (test.manuallyEndedAt || attempt.submittedAt || attempt.suspendedAt || !attempt.visibility) return attempt;
  const visibility = attempt.visibility;
  const hidden = visibility.interruption;
  // Silence can mean a slow network or a busy foreground app. Only an
  // observed background transition is evidence for a violation pause.
  if (!hidden || hidden.reason !== 'app-background') return attempt;
  const startedAt = hidden.startedAt;
  if (now.getTime() - startedAt.getTime() <= VISIBILITY_GRACE_MS) return attempt;
  return suspend(test, attempt, session, {
    id: hidden.id, reason: hidden.reason, startedAt, returnedAt: null,
  }, now);
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{12,100}$/.test(value);
function dateOf(value: unknown, now: Date) {
  const at = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 2000) throw new HttpError(400, 'Invalid visibility timestamp.');
  return new Date(Math.min(at.getTime(), now.getTime()));
}

export async function reportVisibility(test: TestRoomDoc, studentId: unknown, body: Record<string, unknown>) {
  if (!validId(body.clientId) || !Number.isSafeInteger(body.sequence) || Number(body.sequence) < 1 || typeof body.visible !== 'boolean' || !Number.isSafeInteger(body.resumeVersion) || !Array.isArray(body.interruptions) || body.interruptions.length > 32)
    throw new HttpError(400, 'Invalid visibility report.');
  return withTestLock(test, async (fresh, session) => {
    let attempt = await TestAttempt.findOne({ testId: fresh._id, tuitionId: fresh.tuitionId, studentId }).session(session) as TestAttemptDoc | null;
    if (!attempt) throw new HttpError(400, 'Start the test first.');
    const now = new Date();
    if (fresh.manuallyEndedAt) return finalizeLocked(fresh, attempt, session, now, true);
    if (attempt.submittedAt || Number(body.resumeVersion) !== (attempt.resumeVersion ?? 0)) return attempt;
    const previous = attempt.visibility;
    if (previous?.retiredClients.includes(String(body.clientId)) || (previous && previous.clientId === body.clientId && Number(body.sequence) <= previous.sequence)) return attempt;
    const observedAt = dateOf(body.observedAt, now);
    if (observedAt < attempt.startedAt || (previous && observedAt < previous.lastSeenAt)) return attempt;
    const interruptions: Interruption[] = (body.interruptions as Record<string, unknown>[]).map(raw => {
      if (!raw || !validId(raw.id) || !REASONS.includes(String(raw.reason))) throw new HttpError(400, 'Invalid interruption.');
      const startedAt = dateOf(raw.startedAt, now);
      const returnedAt = raw.returnedAt == null ? null : dateOf(raw.returnedAt, now);
      if (startedAt < attempt!.startedAt || startedAt > observedAt || (returnedAt && (returnedAt < startedAt || returnedAt > observedAt))) throw new HttpError(400, 'Invalid interruption interval.');
      return { id: raw.id, reason: String(raw.reason), startedAt, returnedAt };
    }).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    let completed = false;
    for (const interruption of interruptions) {
      const known = attempt.events.find(event => event.interruptionId === interruption.id);
      if (known) {
        if (known.startedAt && known.startedAt.getTime() !== interruption.startedAt.getTime()) throw new HttpError(409, 'Interruption timestamps changed.');
        if (known.ended && !known.returnedAt && interruption.returnedAt) {
          attempt = await TestAttempt.findOneAndUpdate({ _id: attempt._id, 'events.interruptionId': interruption.id }, {
            $set: { 'events.$.returnedAt': interruption.returnedAt }, $inc: { rev: 1 },
          }, { returnDocument: 'after', session }) as TestAttemptDoc;
        }
        continue;
      }
      if (attempt.suspendedAt) break;
      const hidden = previous?.interruption;
      if (hidden?.id === interruption.id && hidden.startedAt.getTime() !== interruption.startedAt.getTime()) throw new HttpError(409, 'Interruption timestamps changed.');
      const duration = (interruption.returnedAt ?? now).getTime() - interruption.startedAt.getTime();
      if (duration > VISIBILITY_GRACE_MS && interruption.reason === 'app-background') attempt = await suspend(fresh, attempt, session, interruption, now);
      else if (interruption.returnedAt) {
        completed = !previous?.interruption || previous.interruption.id === interruption.id;
        attempt = await TestAttempt.findOneAndUpdate({ _id: attempt._id, submittedAt: null, rev: revOf(attempt) }, {
          $push: { events: { type: 'away', at: now, ended: false, awayMs: duration, interruptionId: interruption.id, reason: interruption.reason, startedAt: interruption.startedAt, returnedAt: interruption.returnedAt } },
          $inc: { rev: 1 },
        }, { returnDocument: 'after', session }) as TestAttemptDoc;
      }
    }
    if (attempt.suspendedAt) return attempt;
    // A completed short interruption explains a delayed foreground report.
    // A heartbeat gap alone is not evidence that the app was backgrounded.
    if (body.visible && previous?.interruption?.reason === 'app-background' && !interruptions.some(i => i.id === previous.interruption!.id && i.returnedAt)) throw new HttpError(409, 'Report the interruption before answering.');
    if (!completed) attempt = await reconcileVisibilityLocked(fresh, attempt, session, now);
    if (attempt.suspendedAt) return attempt;
    if (deadlineOf(fresh, attempt) <= now) return finalizeLocked(fresh, attempt, session, now);
    const open = interruptions.find(i => !i.returnedAt);
    if (!body.visible && !open && !previous?.interruption) throw new HttpError(400, 'A hidden screen needs an interruption timestamp.');
    const interruption = body.visible ? null : open ?? previous?.interruption ?? null;
    attempt = await TestAttempt.findOneAndUpdate({ _id: attempt._id, submittedAt: null, suspendedAt: null, rev: revOf(attempt) }, {
      $set: { visibility: { clientId: body.clientId, sequence: body.sequence, lastSeenAt: observedAt, interruption,
        retiredClients: [...(previous?.retiredClients ?? []), ...(previous && previous.clientId !== body.clientId ? [previous.clientId] : [])] } },
      $inc: { rev: 1 },
    }, { returnDocument: 'after', session }) as TestAttemptDoc;
    return reconcileVisibilityLocked(fresh, attempt, session, now);
  });
}
