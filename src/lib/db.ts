import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI as string;

// The database to use: MONGODB_DB, else one named in the connection string's
// path, else "pcmb" — where the Vedclass extractor loads the question bank
// (extractor/papers_db.py picks it the same way).
const DB_NAME =
  process.env.MONGODB_DB ||
  (/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(MONGODB_URI ?? "") ? undefined : "pcmb");

if (!MONGODB_URI) {
  throw new Error(
    "Missing MONGODB_URI environment variable. Set it in web/.env.local"
  );
}

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Reuse the connection across hot reloads / serverless invocations.
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
      bufferCommands: false,
      dbName: DB_NAME,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Forget the failed attempt so the next request tries again, instead of
    // every request failing on the same rejected promise until a restart.
    cache.promise = null;
    throw error;
  }
  return cache.conn;
}
