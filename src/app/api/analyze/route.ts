import { classifyFailure } from "@/lib/health/failures";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getProvider } from "@/lib/ai";
import { getLayer2 } from "@/lib/insights/layer2";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";

// POST /api/analyze — streams a problem validation for the given idea as plain
// text (the client appends chunks directly). Part 1 vertical slice.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  void track(EVENTS.IDEA_VALIDATED, { userId: auth.id });

  let body: { idea?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const idea = body.idea?.trim();
  if (!idea) {
    return Response.json({ error: "Please describe your idea." }, { status: 400 });
  }
  if (idea.length > 2000) {
    return Response.json({ error: "Idea is too long (max 2000 chars)." }, { status: 400 });
  }

  const layer2 = getLayer2();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of layer2.validateProblem({ idea, locale: body.locale }, req.signal)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // Never the provider's own words. This used to stream the raw upstream
        // body into the page, which showed every user our vendor's name, our
        // billing state and a request id when a key ran out of credit.
        const { userMessage, detail, kind } = classifyFailure(err);
        console.error(`analyze failed (${kind}):`, detail.slice(0, 300));
        controller.enqueue(encoder.encode(`\n\n> ⚠️ ${userMessage}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Provider": getProvider().label,
    },
  });
}
