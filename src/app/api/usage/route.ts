import { getUsage } from "@/lib/db/ratelimit";
import { LIMITS, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";

// GET /api/usage — current copilot rate-limit usage for the signed-in user.
// Read-only: does not consume quota.
export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const { limit, windowMs } = LIMITS.copilot;
  const usage = getUsage(auth.id, "copilot", limit, windowMs);

  return Response.json(usage, { headers: { "Cache-Control": "no-store" } });
}
