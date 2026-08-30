import { classifyFailure } from "@/lib/health/failures";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getProvider } from "@/lib/ai";
import { getPipeline } from "@/lib/pipeline";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";
import { canUseFeature } from "@/lib/billing/entitlements";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_IDEAS = 2;
const MAX_IDEAS = 3;

// POST /api/compare — score 2–3 candidate ideas against each other and rank them.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const entitled = await canUseFeature(auth.id, "compare");
  if (!entitled.allowed) {
    return Response.json(
      { error: entitled.reason, upgradeTo: entitled.upgradeTo, quota: "feature_compare" },
      { status: 402 },
    );
  }

  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  void track(EVENTS.IDEAS_COMPARED, { userId: auth.id });

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
    const comparison = await getPipeline().compareIdeas({ ideas, locale: body.locale }, req.signal);
    return Response.json(comparison, {
      headers: { "Cache-Control": "no-store", "X-Provider": getProvider().label },
    });
  } catch (err) {
    // The upstream message is for the log, never for the browser: it carries
    // the vendor's name, our account state and their request id.
    const { userMessage, detail, kind, selfHealing } = classifyFailure(err);
    console.error(`compare failed (${kind}):`, detail.slice(0, 300));
    return Response.json(
      { error: userMessage, retryable: selfHealing },
      // 503 when the dependency is down rather than 500: it says "come back",
      // and it keeps genuine bugs on our side distinguishable in the logs.
      { status: kind === "bad_request" ? 500 : 503 },
    );
  }
}
