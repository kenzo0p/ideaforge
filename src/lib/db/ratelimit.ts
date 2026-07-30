import { col } from "./index";

// ---------------------------------------------------------------------------
// Per-user sliding-window rate limiter (MongoDB-backed).
//
// Each guarded request records a timestamped hit; a request is allowed only if
// the count within the trailing window is below the limit. Durable across
// restarts and shared across instances (unlike an in-memory limiter).
//
// Old hits are reaped by a TTL index on `expiresAt` rather than deleted inline.
// TTL sweeps only run about once a minute, so every query still filters on the
// window explicitly — the index is housekeeping, not correctness.
// ---------------------------------------------------------------------------

interface HitDoc {
  userId: string;
  kind: string;
  createdAt: number;
  expiresAt: Date;
}

const hits = () => col<HitDoc>("rateHits");

export interface RateResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry (only meaningful when !ok). */
  retryAfterSec: number;
}

export async function checkRateLimit(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const c = await hits();

  const inWindow = await c
    .find({ userId, kind, createdAt: { $gte: cutoff } }, { projection: { createdAt: 1 } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();

  if (inWindow.length >= limit) {
    const oldest = inWindow[0]?.createdAt ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  await c.insertOne({
    userId,
    kind,
    createdAt: now,
    // Keep the row a little past the window so the count is never short-changed
    // by a TTL sweep landing mid-window.
    expiresAt: new Date(now + windowMs * 2),
  });
  return { ok: true, remaining: limit - inWindow.length - 1, retryAfterSec: 0 };
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  /** Seconds until the oldest hit falls out of the window (0 when idle). */
  resetInSec: number;
}

/** Read current usage for a bucket without recording a hit. */
export async function getUsage(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): Promise<UsageSnapshot> {
  const now = Date.now();
  const c = await hits();
  const filter = { userId, kind, createdAt: { $gte: now - windowMs } };

  const [used, oldest] = await Promise.all([
    c.countDocuments(filter),
    c.find(filter, { projection: { createdAt: 1 } }).sort({ createdAt: 1 }).limit(1).next(),
  ]);

  return {
    used,
    limit,
    resetInSec: oldest ? Math.max(0, Math.ceil((oldest.createdAt + windowMs - now) / 1000)) : 0,
  };
}
