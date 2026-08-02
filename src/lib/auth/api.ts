import { getCurrentUser } from "./session";
import { checkRateLimit, getUsage } from "@/lib/db/ratelimit";
import type { User } from "@/lib/db/users";

/**
 * Gate an API route on authentication. Returns the signed-in user, or a 401
 * Response to return directly:
 *
 *   const auth = await requireApiUser();
 *   if (auth instanceof Response) return auth;
 *   // ...use auth.id
 */
export async function requireApiUser(): Promise<User | Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Please sign in to use IdeaForge." }, { status: 401 });
  }
  return user;
}

const DAY_MS = 86_400_000;

/**
 * Two limits, not one.
 *
 * The per-minute window stops a runaway client; it does nothing about cost. At
 * 20/minute a single account could make ~28,000 model calls a day, which is a
 * four-figure bill from one signup. The daily cap is the actual spend guardrail
 * — the burst limit only shapes traffic.
 *
 * Both are per-user and both are overridable so a demo account can be raised
 * without a redeploy.
 */
export const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  // Expensive LLM + web/search calls (analyze, research, plan, compare, review).
  copilot: { limit: 20, windowMs: 60_000 },
  // Agent chat is lighter.
  agent: { limit: 40, windowMs: 60_000 },
};

/** Daily ceilings — the cost cap. Tune per tier, or via env for a demo. */
export const DAILY_LIMITS: Record<string, number> = {
  copilot: Number(process.env.DAILY_COPILOT_LIMIT ?? 60),
  agent: Number(process.env.DAILY_AGENT_LIMIT ?? 200),
};

export interface QuotaSnapshot {
  /** Burst window. */
  used: number;
  limit: number;
  resetInSec: number;
  /** Rolling 24 hours — what actually bounds spend. */
  dailyUsed: number;
  dailyLimit: number;
  dailyResetInSec: number;
}

/**
 * Enforce both limits for a bucket. Returns a 429 Response when either is
 * exceeded, otherwise null (proceed).
 *
 * The daily cap is checked first: telling someone to retry in 12 seconds when
 * they're actually out for the day would be a lie.
 */
export async function enforceRateLimit(
  userId: string,
  kind: keyof typeof LIMITS,
): Promise<Response | null> {
  const daily = await checkRateLimit(userId, `${kind}:day`, DAILY_LIMITS[kind], DAY_MS);
  if (!daily.ok) {
    const hours = Math.ceil(daily.retryAfterSec / 3600);
    return Response.json(
      {
        error: `Daily limit reached (${DAILY_LIMITS[kind]} copilot runs). Resets in about ${hours}h.`,
        quota: "daily",
      },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSec) } },
    );
  }

  const { limit, windowMs } = LIMITS[kind];
  const result = await checkRateLimit(userId, kind, limit, windowMs);
  if (!result.ok) {
    return Response.json(
      { error: `Going a bit fast — try again in ${result.retryAfterSec}s.`, quota: "burst" },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
    );
  }
  return null;
}

/** Both meters for the sidebar, without recording a hit. */
export async function quotaSnapshot(
  userId: string,
  kind: keyof typeof LIMITS = "copilot",
): Promise<QuotaSnapshot> {
  const { limit, windowMs } = LIMITS[kind];
  const [burst, daily] = await Promise.all([
    getUsage(userId, kind, limit, windowMs),
    getUsage(userId, `${kind}:day`, DAILY_LIMITS[kind], DAY_MS),
  ]);
  return {
    used: burst.used,
    limit: burst.limit,
    resetInSec: burst.resetInSec,
    dailyUsed: daily.used,
    dailyLimit: daily.limit,
    dailyResetInSec: daily.resetInSec,
  };
}
