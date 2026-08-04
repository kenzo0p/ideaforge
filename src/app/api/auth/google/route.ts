import { verifyFirebaseIdToken } from "@/lib/auth/firebase";
import { upsertGoogleUser } from "@/lib/db/users";
import { startSession } from "@/lib/auth/session";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const runtime = "nodejs";

// POST /api/auth/google  { idToken }
//
// Exchanges a verified Firebase ID token for one of our session cookies. This
// is the only place a Google identity becomes an IdeaForge account, so the
// checks live here:
//   • the token's signature/issuer/audience are verified (see lib/auth/firebase)
//   • Google must report the address as verified, otherwise we refuse — linking
//     an unverified address to an existing account is an account-takeover path
//   • the resulting account skips our own email verification, because Google
//     has already proven ownership
export async function POST(req: Request) {
  let idToken: string | undefined;
  try {
    const body = (await req.json()) as { idToken?: unknown };
    if (typeof body.idToken === "string") idToken = body.idToken;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!idToken) {
    return Response.json({ error: "Missing idToken." }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(idToken);
  } catch (err) {
    console.error("Google sign-in: token rejected —", err instanceof Error ? err.message : err);
    // Deliberately vague: never tell a caller which check failed.
    return Response.json({ error: "Could not verify that Google sign-in." }, { status: 401 });
  }

  if (!identity.emailVerified) {
    return Response.json(
      { error: "Your Google account's email address is not verified." },
      { status: 403 },
    );
  }

  try {
    const user = await upsertGoogleUser(identity);
    void track(EVENTS.SIGNED_IN, { userId: user.id, props: { method: "google" } });
    await startSession(user.id);
    return Response.json({ ok: true, email: user.email });
  } catch (err) {
    console.error("Google sign-in: could not establish session —", err);
    return Response.json({ error: "Could not complete sign-in." }, { status: 500 });
  }
}
