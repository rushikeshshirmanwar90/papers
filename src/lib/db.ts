import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI as string;

// The database to use: MONGODB_DB, else one named in the connection string's
// path, else "pcmb" — where the Vedclass extractor loads the question bank.
const DB_NAME =
  process.env.MONGODB_DB ||
  (/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(MONGODB_URI ?? "") ? undefined : "pcmb");

if (!MONGODB_URI) {
  throw new Error(
    "Missing MONGODB_URI environment variable. Set it in .env.local"
  );
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      dbName: DB_NAME,
      bufferCommands: false,

      // --- Connection pool ---
      // Up to 10 concurrent operations instead of the default 5.
      // On Atlas M0 (free) the server cap is 500; 10 is safe.
      maxPoolSize: 10,
      minPoolSize: 1,

      // --- Timeouts ---
      // How long to wait for a server to become available (default: 30 s).
      // 10 s is enough; 30 s just makes the client hang.
      serverSelectionTimeoutMS: 10_000,

      // TCP connect + TLS handshake timeout (default: 30 s → 10 s).
      connectTimeoutMS: 10_000,

      // Per-operation socket timeout; prevents a stalled query from blocking
      // a worker indefinitely (default: 0 = no timeout).
      socketTimeoutMS: 45_000,

      // Keep idle connections alive so the pool is warm for the next request.
      // Heartbeat every 10 s; Atlas idles out at 30 s without traffic.
      heartbeatFrequencyMS: 10_000,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Forget the failed attempt so the next request retries from scratch
    // instead of every request failing on the same rejected promise.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}
