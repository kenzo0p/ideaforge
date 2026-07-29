import { getDb } from "./index";

// ---------------------------------------------------------------------------
// Per-user sliding-window rate limiter (SQLite-backed, zero-config).
//
// Each guarded request records a timestamped hit; a request is allowed only if
// the count within the trailing window is below the limit. Durable across
// restarts and shared across processes (unlike an in-memory limiter).
// ---------------------------------------------------------------------------

export interface RateResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry (only meaningful when !ok). */
  retryAfterSec: number;
}

export function checkRateLimit(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): RateResult {
  const db = getDb();
  const now = Date.now();
  const cutoff = now - windowMs;

  // Drop expired hits for this bucket, then count what's left in the window.
  db.prepare("DELETE FROM rate_hits WHERE user_id = ? AND kind = ? AND created_at < ?").run(
    userId,
    kind,
    cutoff,
  );
  const { c } = db
    .prepare("SELECT COUNT(*) AS c FROM rate_hits WHERE user_id = ? AND kind = ?")
    .get(userId, kind) as { c: number };

  if (c >= limit) {
    const { m } = db
      .prepare("SELECT MIN(created_at) AS m FROM rate_hits WHERE user_id = ? AND kind = ?")
      .get(userId, kind) as { m: number };
    const retryAfterSec = Math.max(1, Math.ceil((m + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  db.prepare("INSERT INTO rate_hits (user_id, kind, created_at) VALUES (?, ?, ?)").run(
    userId,
    kind,
    now,
  );
  return { ok: true, remaining: limit - c - 1, retryAfterSec: 0 };
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  /** Seconds until the oldest hit falls out of the window (0 when idle). */
  resetInSec: number;
}

/** Read current usage for a bucket without recording a hit. */
export function getUsage(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): UsageSnapshot {
  const db = getDb();
  const now = Date.now();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c, MIN(created_at) AS m FROM rate_hits WHERE user_id = ? AND kind = ? AND created_at >= ?",
    )
    .get(userId, kind, now - windowMs) as { c: number; m: number | null };

  return {
    used: row.c,
    limit,
    resetInSec: row.m ? Math.max(0, Math.ceil((row.m + windowMs - now) / 1000)) : 0,
  };
}
