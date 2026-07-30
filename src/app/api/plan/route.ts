import { getProvider } from "@/lib/ai";
import { getSearchProvider } from "@/lib/search";
import { getLayer2 } from "@/lib/insights/layer2";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";
import type { ResearchReport } from "@/lib/insights/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/plan — Project HUB. Turns an idea (optionally enriched with a prior
// research report) into a full ProjectPlan and returns it as JSON.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  let body: { idea?: string; locale?: string; research?: ResearchReport };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const idea = body.idea?.trim();
  if (!idea) return Response.json({ error: "Please describe your idea." }, { status: 400 });
  if (idea.length > 2000) {
    return Response.json({ error: "Idea is too long (max 2000 chars)." }, { status: 400 });
  }

  try {
    const plan = await getLayer2().projectHub(
      { idea, locale: body.locale },
      body.research ?? null,
      req.signal,
    );
    return Response.json(plan, {
      headers: {
        "Cache-Control": "no-store",
        "X-Provider": getProvider().label,
        "X-Search-Provider": getSearchProvider().label,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Project HUB failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
