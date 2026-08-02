import { consumeOAuthState, saveConnection } from "@/lib/db/integrations";
import { exchangeNotionCode } from "@/lib/integrations/notion";
import { publicUrl } from "@/lib/http/origin";

export const runtime = "nodejs";

// GET /api/integrations/notion/callback — the OAuth return leg.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  // The state lookup is the only thing that tells us *whose* callback this is.
  // A missing or unknown state means a forged or replayed request; there is no
  // safe way to guess the user, so it's rejected outright.
  const claim = state ? await consumeOAuthState(state, "notion") : null;
  const back = claim?.returnTo ?? "/settings";

  if (denied) return Response.redirect(await publicUrl(`${back}?integration=cancelled`), 302);
  if (!claim || !code) {
    return Response.redirect(await publicUrl(`${back}?integration=invalid`), 302);
  }

  try {
    const token = await exchangeNotionCode(code);
    await saveConnection({
      userId: claim.userId,
      provider: "notion",
      accountLabel: token.workspaceName,
      accessToken: token.accessToken,
      meta: { workspaceId: token.workspaceId },
    });
    return Response.redirect(await publicUrl(`${back}?integration=notion-connected`), 302);
  } catch (err) {
    console.error("Notion connect failed:", err instanceof Error ? err.message : err);
    return Response.redirect(await publicUrl(`${back}?integration=failed`), 302);
  }
}
