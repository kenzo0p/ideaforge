import { getProvider } from "@/lib/ai";
import { getSearchProvider } from "@/lib/search";
import { getLayer2 } from "@/lib/insights/layer2";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/discover — Problem Discovery. Surfaces real-world problems worth
// solving in a domain, grounded in current web signals. Body: { domain?, locale? }
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  let body: { domain?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if ((body.domain?.length ?? 0) > 200) {
    return Response.json({ error: "Domain is too long." }, { status: 400 });
  }

  try {
    const result = await getLayer2().discoverProblems(
      { domain: body.domain, locale: body.locale },
      req.signal,
    );
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Provider": getProvider().label,
        "X-Search-Provider": getSearchProvider().label,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Problem discovery failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
