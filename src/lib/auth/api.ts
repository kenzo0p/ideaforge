import { getCurrentUser } from "./session";
import { checkRateLimit } from "@/lib/db/ratelimit";
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

// Per-kind rate limits (requests per window, per user).
export const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  // Expensive LLM + web/search calls (analyze, research, plan).
  copilot: { limit: 20, windowMs: 60_000 },
  // Agent chat is lighter.
  agent: { limit: 40, windowMs: 60_000 },
};

/**
 * Enforce the per-user rate limit for a bucket. Returns a 429 Response when the
 * limit is exceeded, otherwise null (proceed).
 */
export async function enforceRateLimit(
  userId: string,
  kind: keyof typeof LIMITS,
): Promise<Response | null> {
  const { limit, windowMs } = LIMITS[kind];
  const result = await checkRateLimit(userId, kind, limit, windowMs);
  if (!result.ok) {
    return Response.json(
      { error: `Rate limit reached. Try again in ${result.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
    );
  }
  return null;
}
