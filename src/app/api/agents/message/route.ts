import { handleAgentMessage } from "@/lib/agents/handler";
import { getCurrentUser } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/auth/api";

export const runtime = "nodejs";

// POST /api/agents/message — the in-app Agent Console transport.
// Body: { text, projectId?, locale? } → { reply }
export async function POST(req: Request) {
  let body: { text?: string; projectId?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) return Response.json({ error: "Say something to the agent." }, { status: 400 });
  if (text.length > 1000) return Response.json({ error: "Message too long." }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in to use the agent." }, { status: 401 });
  const limited = await enforceRateLimit(user.id, "agent");
  if (limited) return limited;

  try {
    const reply = await handleAgentMessage({
      text,
      userId: user.id,
      projectId: body.projectId ?? null,
      channel: "console",
      locale: body.locale,
    });
    return Response.json({ reply }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
