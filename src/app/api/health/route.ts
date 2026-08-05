import { getDb } from "@/lib/db/index";
import { recordFailure, recordSuccess, publicHealth } from "@/lib/health/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — for uptime monitors and the platform's own health check.
 *
 * Two rules shape what comes back:
 *
 *   • No detail. Status words only. An unauthenticated endpoint that names the
 *     failing vendor and quotes its error is free reconnaissance, and this one
 *     is meant to be hit by anyone with a monitor.
 *   • 200 unless the process itself is unusable. A degraded AI provider is
 *     reported in the body but still answers 200, because a platform health
 *     check that fails on it will pull a serving instance out of rotation and
 *     replace an "AI is down" outage with a total one.
 */
export async function GET() {
  // The database is checked live rather than read from the registry: it is the
  // one dependency where "nothing has failed recently" and "it is reachable"
  // genuinely differ, since a quiet instance may not have queried in minutes.
  let dbOk = true;
  try {
    await (await getDb()).command({ ping: 1 });
    recordSuccess("db");
  } catch (err) {
    dbOk = false;
    recordFailure("db", err);
  }

  const health = publicHealth();
  return Response.json(
    { status: health.status, checks: health.checks, at: new Date().toISOString() },
    {
      // Never cached: a cached health check is a lie with a timestamp on it.
      status: dbOk ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
