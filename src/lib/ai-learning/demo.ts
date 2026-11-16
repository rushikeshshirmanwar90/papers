import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '@/lib/http';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '10.0.2.2']);
export function demoEnabled(env = process.env) {
  return env.NODE_ENV === 'development' && env.AI_LEARNING_DEMO_ENABLED === 'true' && env.AI_LEARNING_LOCAL_BOUND === 'true';
}

// The standard dev launcher binds to loopback when demos are explicitly enabled.
// Refuse reverse-proxy requests and browser origins outside the local machine.
export function requireLocalDemo(req: Request) {
  if (!demoEnabled()) throw new HttpError(404, 'Not found.');
  const forwardedFor = req.headers.get('x-forwarded-for');
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (!LOCAL_HOSTS.has(new URL(req.url).hostname) || req.headers.has('forwarded') ||
      (forwardedFor && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(forwardedFor)) ||
      (forwardedHost && !LOCAL_HOSTS.has(new URL(`http://${forwardedHost}`).hostname))) {
    throw new HttpError(403, 'Synthetic demos require local development.');
  }
  const origin = req.headers.get('origin');
  if (origin && !LOCAL_HOSTS.has(new URL(origin).hostname)) throw new HttpError(403, 'Local origin required.');
}

declare global {
  // eslint-disable-next-line no-var
  var _aiDemoSession: { token: string; expiresAt: number } | undefined;
}
export function issueDemoSession(req: Request) {
  requireLocalDemo(req);
  // A non-simple header prevents a remote web page from requesting a session.
  if (req.headers.get('x-ai-learning-local') !== '1') throw new HttpError(403, 'Local development client required.');
  if (!global._aiDemoSession || global._aiDemoSession.expiresAt <= Date.now()) {
    global._aiDemoSession = { token: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 60 * 60_000 };
  }
  return global._aiDemoSession;
}
export function requireDemoSession(req: Request) {
  requireLocalDemo(req);
  const session = global._aiDemoSession;
  const supplied = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${session?.token ?? ''}`);
  if (!session || session.expiresAt <= Date.now() || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new HttpError(401, 'Open the local synthetic demo again.');
  }
}
