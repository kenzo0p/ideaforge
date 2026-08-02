import { consumeOAuthState, saveConnection } from "@/lib/db/integrations";
import { exchangeGoogleCode } from "@/lib/integrations/google";
import { publicUrl } from "@/lib/http/origin";

export const runtime = "nodejs";

// GET /api/integrations/google/callback — the OAuth return leg.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  // See the Notion callback: state is what binds this response to a user.
  const claim = state ? await consumeOAuthState(state, "google") : null;
  const back = claim?.returnTo ?? "/settings";

  if (denied) return Response.redirect(await publicUrl(`${back}?integration=cancelled`), 302);
  if (!claim || !code) {
    return Response.redirect(await publicUrl(`${back}?integration=invalid`), 302);
  }

  try {
    const token = await exchangeGoogleCode(code);
    await saveConnection({
      userId: claim.userId,
      provider: "google",
      accountLabel: token.email,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
    });
    return Response.redirect(await publicUrl(`${back}?integration=google-connected`), 302);
  } catch (err) {
    console.error("Google connect failed:", err instanceof Error ? err.message : err);
    return Response.redirect(await publicUrl(`${back}?integration=failed`), 302);
  }
}
