import { one, run } from "./index";

// ---------------------------------------------------------------------------
// Per-user sliding-window rate limiter (SQLite-backed).
//
// Each guarded request records a timestamped hit; a request is allowed only if
// the count within the trailing window is below the limit. Durable across
// restarts and shared across instances (unlike an in-memory limiter).
// ---------------------------------------------------------------------------

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

  // Drop expired hits for this bucket, then count what's left in the window.
  await run("DELETE FROM rate_hits WHERE user_id = ? AND kind = ? AND created_at < ?", [
    userId,
    kind,
    cutoff,
  ]);
  const row = await one<{ c: number; m: number | null }>(
    "SELECT COUNT(*) AS c, MIN(created_at) AS m FROM rate_hits WHERE user_id = ? AND kind = ?",
    [userId, kind],
  );
  const count = row?.c ?? 0;

  if (count >= limit) {
    const oldest = row?.m ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  await run("INSERT INTO rate_hits (user_id, kind, created_at) VALUES (?, ?, ?)", [
    userId,
    kind,
    now,
  ]);
  return { ok: true, remaining: limit - count - 1, retryAfterSec: 0 };
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
  const row = await one<{ c: number; m: number | null }>(
    "SELECT COUNT(*) AS c, MIN(created_at) AS m FROM rate_hits WHERE user_id = ? AND kind = ? AND created_at >= ?",
    [userId, kind, now - windowMs],
  );

  return {
    used: row?.c ?? 0,
    limit,
    resetInSec: row?.m ? Math.max(0, Math.ceil((row.m + windowMs - now) / 1000)) : 0,
  };
}
