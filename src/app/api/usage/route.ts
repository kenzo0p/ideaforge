import { quotaSnapshot, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";

// GET /api/usage — burst and daily quota for the signed-in user.
// Read-only: does not consume quota.
export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  return Response.json(await quotaSnapshot(auth.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
