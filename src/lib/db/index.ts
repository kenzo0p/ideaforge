import { MongoClient, type Collection, type Db, type Document } from "mongodb";

// ---------------------------------------------------------------------------
// MongoDB persistence.
//
// One connection per process, cached on globalThis so dev/HMR reloads and warm
// serverless invocations reuse the pool instead of opening a new one each time
// (the classic way to exhaust an Atlas connection limit).
//
// Modelling notes:
//   • _id holds our own UUID / token strings rather than an ObjectId. The app
//     already generates ids and puts them in URLs, and it buys a free unique
//     index on the natural key.
//   • Milestone progress and workspace items are embedded in their project.
//     They are only ever read alongside it, they are bounded in size, and it
//     makes deleting a project atomic — no orphans, no cascade to emulate.
//   • Everything with a lifetime (sessions, verification/reset tokens, link
//     codes, rate hits) carries an `expiresAt` Date with a TTL index, so Mongo
//     reaps them for us. SQLite needed manual sweeps.
//   • Times stay epoch-millisecond numbers in the domain types, matching the
//     old API exactly. `expiresAt` is the one Date, because TTL requires it.
// ---------------------------------------------------------------------------

export const DB_NAME = process.env.MONGODB_DB ?? "ideaforge";

function uri(): string {
  const value = process.env.MONGODB_URI;
  if (!value) {
    throw new Error(
      "MONGODB_URI is not set. Create a free cluster at https://cloud.mongodb.com, " +
        "then copy its connection string into MONGODB_URI (see .env.example).",
    );
  }
  return value;
}

const g = globalThis as unknown as { __ideaforgeMongo?: Promise<Db> };

/** The shared database handle, connected and indexed exactly once. */
export function getDb(): Promise<Db> {
  if (!g.__ideaforgeMongo) {
    // Never cache a rejected promise: a bad URI would otherwise keep failing
    // for the life of the process even after the environment is corrected.
    g.__ideaforgeMongo = connect().catch((err) => {
      g.__ideaforgeMongo = undefined;
      throw err;
    });
  }
  return g.__ideaforgeMongo;
}

async function connect(): Promise<Db> {
  const client = new MongoClient(uri(), {
    // Fail fast with a useful message instead of hanging a request for 30s.
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  });

  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/authentication failed|bad auth/i.test(message)) {
      throw new Error(
        "MongoDB rejected our credentials. Check the username and password in " +
          "MONGODB_URI — a password with @ : / ? # or % must be percent-encoded.",
        { cause: err },
      );
    }
    if (/ENOTFOUND|querySrv|ETIMEDOUT|server selection/i.test(message)) {
      throw new Error(
        "Could not reach the MongoDB cluster. Check the host in MONGODB_URI, and " +
          "that your deployment's IP is allowed under Atlas → Network Access.",
        { cause: err },
      );
    }
    throw err;
  }

  const db = client.db(DB_NAME);
  await ensureIndexes(db);
  return db;
}

/** Typed handle to a collection. */
export async function col<T extends Document>(name: string): Promise<Collection<T>> {
  return (await getDb()).collection<T>(name);
}

// --- Indexes ---------------------------------------------------------------
// createIndex is idempotent, so this is safe to run on every cold start.

async function ensureIndexes(db: Db): Promise<void> {
  const ttl = { expireAfterSeconds: 0 };

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),

    db.collection("sessions").createIndex({ userId: 1 }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, ttl),

    db.collection("verificationTokens").createIndex({ userId: 1 }),
    db.collection("verificationTokens").createIndex({ expiresAt: 1 }, ttl),

    db.collection("passwordResetTokens").createIndex({ userId: 1 }),
    db.collection("passwordResetTokens").createIndex({ expiresAt: 1 }, ttl),

    // Sliding-window counter: the compound index serves the window count.
    db.collection("rateHits").createIndex({ userId: 1, kind: 1, createdAt: 1 }),
    db.collection("rateHits").createIndex({ expiresAt: 1 }, ttl),

    db.collection("telegramLinks").createIndex({ userId: 1 }),
    db.collection("telegramLinkCodes").createIndex({ expiresAt: 1 }, ttl),

    db.collection("reminders").createIndex({ active: 1, nextDueAt: 1 }),
    db.collection("reminders").createIndex({ projectId: 1 }),
    db.collection("reminders").createIndex({ userId: 1 }),

    db.collection("reminderLogs").createIndex({ projectId: 1, createdAt: -1 }),
    db.collection("reminderLogs").createIndex({ userId: 1, createdAt: -1 }),

    db.collection("projects").createIndex({ userId: 1, updatedAt: -1 }),
    // Sparse: only shared projects carry a token, and null must not collide.
    db.collection("projects").createIndex(
      { shareToken: 1 },
      { unique: true, sparse: true },
    ),
  ]);
}
