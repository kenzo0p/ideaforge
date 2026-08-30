import dns from "node:dns";
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

export const DB_NAME = process.env.MONGODB_DB ?? "scrutan";

/** What Node is currently resolving DNS with, for diagnostics. */
function dnsServers(): string {
  try {
    return dns.getServers().join(", ") || "(none configured)";
  } catch {
    return "(unknown)";
  }
}

/**
 * Escape hatch for a broken host resolver.
 *
 * Node reads /etc/resolv.conf through c-ares, which on macOS is frequently
 * either stale or unparseable — an IPv6 link-local nameserver makes it fall
 * back to 127.0.0.1, where nothing answers. The whole app then looks like it
 * has lost its database while every other tool on the machine resolves fine.
 *
 * Off unless set, because silently rerouting a deployment's DNS to a public
 * resolver is not a decision this module should make on anyone's behalf.
 */
function applyDnsOverride(): void {
  const raw = process.env.DNS_SERVERS?.trim();
  if (!raw) return;
  const servers = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (servers.length === 0) return;
  try {
    dns.setServers(servers);
    console.log(`DNS override active: resolving via ${servers.join(", ")}`);
  } catch (err) {
    console.error("DNS_SERVERS is not a valid server list:", err instanceof Error ? err.message : err);
  }
}

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
  __scrutanMongo?: Promise<Db>;
  __scrutanMongoFailedAt?: number;
  __scrutanMongoError?: unknown;
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
  if (!g.__scrutanMongo) {
    // Never cache a rejected promise permanently: a bad URI would otherwise
    // keep failing for the life of the process even once the env is corrected.
    // But do hold the failure briefly so retries can't pile up.
    const since = Date.now() - (g.__scrutanMongoFailedAt ?? 0);
    if (g.__scrutanMongoError !== undefined && since < RETRY_COOLDOWN_MS) {
      return Promise.reject(g.__scrutanMongoError);
    }
    g.__scrutanMongo = connect().then(
      (db) => {
        g.__scrutanMongoError = undefined;
        return db;
      },
      (err) => {
        g.__scrutanMongo = undefined;
        g.__scrutanMongoFailedAt = Date.now();
        g.__scrutanMongoError = err;
        throw err;
      },
    );
  }
  return g.__scrutanMongo;
}

async function connect(): Promise<Db> {
  applyDnsOverride();

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
    // A refused *DNS* query is not a MongoDB problem at all, and sending
    // someone to check Atlas for it wastes their afternoon. It happens on macOS
    // whenever /etc/resolv.conf holds an IPv6 link-local nameserver
    // (fe80::…%en0): Node's c-ares cannot parse the %scope, silently falls back
    // to 127.0.0.1, and nothing is listening there. `dig` keeps working the
    // whole time, because it uses the system resolver rather than c-ares.
    if (/ECONNREFUSED|ESERVFAIL|EREFUSED/i.test(message) && /querySrv|queryA|getaddrinfo/i.test(message)) {
      throw new Error(
        "This machine's DNS resolver refused the lookup, so the cluster was " +
          "never contacted — nothing is wrong with MONGODB_URI or Atlas. " +
          `Node is resolving via ${dnsServers()}. Set a working DNS server in ` +
          "your network settings (e.g. 1.1.1.1), or set DNS_SERVERS=1.1.1.1,8.8.8.8 " +
          "to override it for this app only.",
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
  await backfillUsernames(db);
  return db;
}

/** Typed handle to a collection. */
export async function col<T extends Document>(name: string): Promise<Collection<T>> {
  return (await getDb()).collection<T>(name);
}

/**
 * Give pre-username accounts a handle.
 *
 * Runs once on connect and does nothing when there's nothing to fix, so it
 * costs a single indexed count on every boot after the first.
 */
async function backfillUsernames(db: Db): Promise<void> {
  const users = db.collection<{ _id: string; email: string; name?: string | null; username?: string }>("users");
  const missing = await users.find({ username: { $exists: false } }).limit(500).toArray();
  if (missing.length === 0) return;

  const { suggestUsername, USERNAME_MAX } = await import("@/lib/username");
  const taken = new Set(
    (await users.find({ username: { $exists: true } }, { projection: { username: 1 } }).toArray())
      .map((u) => u.username!),
  );

  for (const u of missing) {
    const base = suggestUsername(u.name || u.email);
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) {
      candidate = `${base.slice(0, USERNAME_MAX - String(n).length)}${n}`;
    }
    taken.add(candidate);
    await users.updateOne({ _id: u._id }, { $set: { username: candidate } });
  }
  console.log(`Assigned usernames to ${missing.length} existing account(s).`);
}

// --- Indexes ---------------------------------------------------------------
// createIndex is idempotent, so this is safe to run on every cold start.

async function ensureIndexes(db: Db): Promise<void> {
  const ttl = { expireAfterSeconds: 0 };

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    // Sparse so accounts predating usernames don't collide on a missing field;
    // backfillUsernames() fills them in on boot.
    db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true }),

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

    // The timeline read, the coalescing lookup and the prune all sort by this.
    db.collection("projectVersions").createIndex({ projectId: 1, createdAt: -1 }),

    // Similarity search scans by owner, then filters by model.
    db.collection("ideaVectors").createIndex({ userId: 1, model: 1 }),
    db.collection("ideaVectors").createIndex({ projectId: 1 }),
    db.collection("groundingReports").createIndex({ userId: 1 }),

    // The public directory and the sitemap read exactly this.
    db.collection("projects").createIndex(
      { listed: 1, listedAt: -1 },
      { partialFilterExpression: { listed: true } },
    ),

    db.collection("analyticsEvents").createIndex({ name: 1, createdAt: -1 }),
    db.collection("analyticsEvents").createIndex({ day: 1 }),
    // Raw events are disposable; the aggregates are the lasting artefact.
    db.collection("analyticsEvents").createIndex({ expiresAt: 1 }, ttl),

    db.collection("watches").createIndex({ active: 1, nextRunAt: 1 }),
    db.collection("watches").createIndex({ userId: 1 }),
    // The whole "what's new?" diff rests on this: a repeat result collides and
    // is rejected, so only genuinely new URLs are ever inserted.
    db.collection("watchFindings").createIndex({ watchId: 1, url: 1 }, { unique: true }),
    db.collection("watchFindings").createIndex({ userId: 1, seen: 1, foundAt: -1 }),
    db.collection("watchFindings").createIndex({ projectId: 1, foundAt: -1 }),

    db.collection("orgs").createIndex({ slug: 1 }, { unique: true }),
    // Unique across *all* workspaces: two orgs claiming the same domain would
    // each silently absorb the other's people. The partial filter keeps orgs
    // that have claimed nothing out of the index — an empty array would
    // otherwise index as a single null key and collide with every other one.
    db.collection("orgs").createIndex(
      { emailDomains: 1 },
      { unique: true, partialFilterExpression: { emailDomains: { $type: "string" } } },
    ),
    // One workspace per person. The uniqueness is the assumption the whole
    // "what plan is this user on?" lookup rests on.
    db.collection("orgMembers").createIndex({ userId: 1 }, { unique: true }),
    db.collection("orgMembers").createIndex({ orgId: 1, role: 1 }),
    // Billing webhooks arrive with a gateway id and nothing else.
    db.collection("orgs").createIndex(
      { providerSubscriptionId: 1 },
      { unique: true, sparse: true },
    ),

    db.collection("integrations").createIndex({ userId: 1 }),
    // OAuth state is short-lived by design; let Mongo reap it.
    db.collection("oauthStates").createIndex({ expiresAt: 1 }, ttl),
    db.collection("projectComments").createIndex({ userId: 1 }),
    // Sparse: only shared projects carry a token, and null must not collide.
    db.collection("projects").createIndex(
      { shareToken: 1 },
      { unique: true, sparse: true },
    ),
  ]);
}
