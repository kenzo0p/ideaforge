import { getProvider } from "@/lib/ai";
import { getLayer2 } from "@/lib/insights/layer2";

export const runtime = "nodejs";

// POST /api/analyze — streams a problem validation for the given idea as plain
// text (the client appends chunks directly). Part 1 vertical slice.
export async function POST(req: Request) {
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
        const message = err instanceof Error ? err.message : "Analysis failed.";
        controller.enqueue(encoder.encode(`\n\n> ⚠️ ${message}`));
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
