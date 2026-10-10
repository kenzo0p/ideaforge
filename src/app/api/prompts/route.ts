import { classifyFailure } from "@/lib/health/failures";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getProvider } from "@/lib/ai";
import { totalTokens, withUsage } from "@/lib/ai/usage";
import { recordUsage } from "@/lib/db/tokens";
import { getPipeline } from "@/lib/pipeline";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/prompts — turns one rough line into several runnable prompts, each
// with a forecast of what it would cost to run.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  void track(EVENTS.PROMPTS_DRAFTED, { userId: auth.id });

  let body: { idea?: string; locale?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const idea = body.idea?.trim();
  if (!idea) return Response.json({ error: "Describe your idea in a line." }, { status: 400 });
  if (idea.length > 2000) {
    return Response.json({ error: "Idea is too long (max 2000 chars)." }, { status: 400 });
  }

  try {
    const { result: set, usage } = await withUsage(() =>
      getPipeline().draftPrompts({ idea, locale: body.locale, count: body.count }, req.signal),
    );

    // A draft that produced nothing usable is a failure, not an empty result:
    // returning an empty set would render as "here are your 0 prompts".
    if (set.prompts.length === 0) {
      return Response.json(
        { error: "Could not draft prompts for that. Try describing the idea in a full sentence." },
        { status: 502 },
      );
    }

    void recordUsage({ userId: auth.id, operation: "prompts", usage });
    return Response.json(set, {
      headers: {
        "Cache-Control": "no-store",
        "X-Provider": getProvider().label,
        "X-Tokens-In": String(usage.inputTokens),
        "X-Tokens-Out": String(usage.outputTokens),
        "X-Tokens-Total": String(totalTokens(usage)),
        "X-Tokens-Estimated": String(usage.estimated),
        "X-Model": usage.model,
      },
    });
  } catch (err) {
    // The upstream message is for the log, never for the browser: it carries
    // the vendor's name, our account state and their request id.
    const { userMessage, detail, kind, selfHealing } = classifyFailure(err);
    console.error(`prompts failed (${kind}):`, detail.slice(0, 300));
    return Response.json({ error: userMessage, retryable: selfHealing }, { status: 502 });
  }
}
