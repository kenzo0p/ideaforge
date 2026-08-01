import { getProvider } from "@/lib/ai";
import { getLayer2 } from "@/lib/insights/layer2";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_IDEAS = 2;
const MAX_IDEAS = 3;

// POST /api/compare — score 2–3 candidate ideas against each other and rank them.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  let body: { ideas?: unknown; locale?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ideas = Array.isArray(body.ideas)
    ? body.ideas.filter((i): i is string => typeof i === "string").map((i) => i.trim()).filter(Boolean)
    : [];

  if (ideas.length < MIN_IDEAS) {
    return Response.json({ error: "Add at least two ideas to compare." }, { status: 400 });
  }
  if (ideas.length > MAX_IDEAS) {
    return Response.json({ error: `Compare at most ${MAX_IDEAS} ideas at once.` }, { status: 400 });
  }
  if (ideas.some((i) => i.length > 2000)) {
    return Response.json({ error: "One of the ideas is too long (max 2000 chars)." }, { status: 400 });
  }

  try {
    const comparison = await getLayer2().compareIdeas({ ideas, locale: body.locale }, req.signal);
    return Response.json(comparison, {
      headers: { "Cache-Control": "no-store", "X-Provider": getProvider().label },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Comparison failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
