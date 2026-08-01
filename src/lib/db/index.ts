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

const g = globalThis as unknown as {
  __ideaforgeMongo?: Promise<Db>;
  __ideaforgeMongoFailedAt?: number;
  __ideaforgeMongoError?: unknown;
};

/**
 * How long to keep replaying the last connection error before trying again.
 *
 * Without this, a failed connect clears the cache, so the *next* request builds
 * another MongoClient — and under sustained failure every request opens its own
 * pool. That is the stampede that turns "the cluster is briefly refusing us"
 * into "the cluster is out of connections". Recovery is still automatic, just
 * paced.
 */
const RETRY_COOLDOWN_MS = 5_000;

/** The shared database handle, connected and indexed exactly once. */
export function getDb(): Promise<Db> {
  if (!g.__ideaforgeMongo) {
    // Never cache a rejected promise permanently: a bad URI would otherwise
    // keep failing for the life of the process even once the env is corrected.
    // But do hold the failure briefly so retries can't pile up.
    const since = Date.now() - (g.__ideaforgeMongoFailedAt ?? 0);
    if (g.__ideaforgeMongoError !== undefined && since < RETRY_COOLDOWN_MS) {
      return Promise.reject(g.__ideaforgeMongoError);
    }
    g.__ideaforgeMongo = connect().then(
      (db) => {
        g.__ideaforgeMongoError = undefined;
        return db;
      },
      (err) => {
        g.__ideaforgeMongo = undefined;
        g.__ideaforgeMongoFailedAt = Date.now();
        g.__ideaforgeMongoError = err;
        throw err;
      },
    );
  }
  return g.__ideaforgeMongo;
}

async function connect(): Promise<Db> {
  const client = new MongoClient(uri(), {
    // The driver's default pool is 100 connections. That is far too many for a
    // small instance talking to a shared-tier cluster: every one needs its own
    // TLS handshake against a 4096-bit certificate, and an Atlas M0 only allows
    // 500 connections in total across all clients. Overshooting shows up as
    // "SSL alert number 80 / tlsv1 alert internal error" with a
    // SystemOverloadedError label, which reads like a TLS bug and is not one.
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE ?? 10),
    minPoolSize: 0,
    // Free instances are CPU-starved and cold-start slowly; 10s was not enough
    // for the first handshake to land.
    serverSelectionTimeoutMS: 20_000,
    connectTimeoutMS: 20_000,
    socketTimeoutMS: 45_000,
    retryWrites: true,
    retryReads: true,
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
    // A TLS alert from Atlas almost never means the TLS config is wrong. It
    // means the cluster refused the connection — usually too many open
    // connections, or the source IP is not allowed.
    if (/tlsv1 alert|SSL alert|ERR_SSL|ssl3_read_bytes/i.test(message)) {
      throw new Error(
        "MongoDB closed the TLS connection. This is usually the cluster refusing " +
          "us, not a certificate problem: check Atlas → Metrics → Connections " +
          "against your tier's limit (M0 allows 500), and confirm Atlas → " +
          "Network Access allows this host. Lower MONGODB_MAX_POOL_SIZE if the " +
          "connection count is near the cap.",
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
    // Serves the "shared with me" half of the access filter.
    db.collection("projects").createIndex({ "members.userId": 1 }),

    db.collection("projectInvites").createIndex({ projectId: 1 }),
    db.collection("projectInvites").createIndex({ email: 1 }),
    db.collection("projectInvites").createIndex({ expiresAt: 1 }, ttl),

    db.collection("projectComments").createIndex({ projectId: 1, createdAt: 1 }),
    db.collection("projectComments").createIndex({ userId: 1 }),
    // Sparse: only shared projects carry a token, and null must not collide.
    db.collection("projects").createIndex(
      { shareToken: 1 },
      { unique: true, sparse: true },
    ),
  ]);
}
