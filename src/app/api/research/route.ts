import { getProvider } from "@/lib/ai";
import { getSearchProvider } from "@/lib/search";
import { getLayer2 } from "@/lib/insights/layer2";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/research — runs DeepSearch for an idea and returns a grounded
// ResearchReport (summary + citations + solution comparison + gaps) as JSON.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  let body: { idea?: string; locale?: string };
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
    const report = await getLayer2().deepSearch({ idea, locale: body.locale }, req.signal);
    return Response.json(report, {
      headers: {
        "Cache-Control": "no-store",
        "X-Provider": getProvider().label,
        "X-Search-Provider": getSearchProvider().label,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DeepSearch failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
