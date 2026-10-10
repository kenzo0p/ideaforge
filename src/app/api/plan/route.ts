import { classifyFailure } from "@/lib/health/failures";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getProvider } from "@/lib/ai";
import { getSearchProvider } from "@/lib/search";
import { getPipeline } from "@/lib/pipeline";
import { withUsage, totalTokens } from "@/lib/ai/usage";
import { recordUsage } from "@/lib/db/tokens";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";
import type { ResearchReport } from "@/lib/pipeline/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/plan — Project HUB. Turns an idea (optionally enriched with a prior
// research report) into a full ProjectPlan and returns it as JSON.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  void track(EVENTS.PLAN_GENERATED, { userId: auth.id });

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
    const { result: plan, usage } = await withUsage(() => getPipeline().projectHub(
      { idea, locale: body.locale },
      body.research ?? null,
      req.signal,
    ));
    void recordUsage({ userId: auth.id, operation: "plan", usage });
    return Response.json(plan, {
      headers: {
        "X-Tokens-In": String(usage.inputTokens),
        "X-Tokens-Out": String(usage.outputTokens),
        "X-Tokens-Total": String(totalTokens(usage)),
        "X-Tokens-Estimated": String(usage.estimated),
        "X-Model": usage.model,
        "Cache-Control": "no-store",
        "X-Provider": getProvider().label,
        "X-Search-Provider": getSearchProvider().label,
      },
    });
  } catch (err) {
    // The upstream message is for the log, never for the browser: it carries
    // the vendor's name, our account state and their request id.
    const { userMessage, detail, kind, selfHealing } = classifyFailure(err);
    console.error(`plan failed (${kind}):`, detail.slice(0, 300));
    return Response.json(
      { error: userMessage, retryable: selfHealing },
      // 503 when the dependency is down rather than 500: it says "come back",
      // and it keeps genuine bugs on our side distinguishable in the logs.
      { status: kind === "bad_request" ? 500 : 503 },
    );
  }
}
