import { getCurrentUser } from "@/lib/auth/session";
import { createOAuthState, type Provider } from "@/lib/db/integrations";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { isNotionConfigured, notionAuthorizeUrl } from "@/lib/integrations/notion";
import { googleAuthorizeUrl, isGoogleDocsConfigured } from "@/lib/integrations/google";
import { safeInternalPath } from "@/lib/http/origin";

export const runtime = "nodejs";

// GET /api/integrations/connect?provider=notion|google&next=/settings
//
// Starts the OAuth dance: mints a single-use state bound to the session user,
// then redirects to the provider.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") as Provider | null;
  const returnTo = safeInternalPath(url.searchParams.get("next"), "/settings");

  if (provider !== "notion" && provider !== "google") {
    return new Response("Unknown provider", { status: 400 });
  }
  // Refuse rather than store a token we cannot protect.
  if (!isEncryptionConfigured()) {
    return Response.redirect(
      new URL(`${returnTo}?integration=misconfigured`, url.origin),
      302,
    );
  }
  const configured = provider === "notion" ? isNotionConfigured() : isGoogleDocsConfigured();
  if (!configured) {
    return Response.redirect(new URL(`${returnTo}?integration=unconfigured`, url.origin), 302);
  }

  const state = await createOAuthState(user.id, provider, returnTo);
  const authorize =
    provider === "notion" ? await notionAuthorizeUrl(state) : await googleAuthorizeUrl(state);

  return Response.redirect(authorize, 302);
}
