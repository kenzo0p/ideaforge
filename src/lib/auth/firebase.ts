import { createRemoteJWKSet, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Firebase ID token verification (server side).
//
// The browser completes the Google popup and hands us a Firebase ID token. That
// token is attacker-controlled input until proven otherwise: anyone can POST an
// arbitrary string to our callback. So we verify it properly —
//
//   • RS256 signature against Google's published keys
//   • iss  === https://securetoken.google.com/<projectId>
//   • aud  === <projectId>            (a token minted for a *different* Firebase
//                                      project must not authenticate here)
//   • exp / iat within tolerance
//   • sub  non-empty (the Firebase uid)
//
// This deliberately avoids firebase-admin: verification only needs the public
// project id, so there's no service-account private key to store or leak.
// ---------------------------------------------------------------------------

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Cached across requests; the library refreshes on key rotation by itself.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

export interface GoogleIdentity {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
  /** Google's own verification of the address — never blindly true. */
  emailVerified: boolean;
}

/** The Firebase project id, shared by the client SDK and this verifier. */
export function firebaseProjectId(): string | undefined {
  return process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
}

export function isGoogleAuthConfigured(): boolean {
  return !!firebaseProjectId() && !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
}

/**
 * Verify a Firebase ID token and return the identity it asserts.
 * Throws on anything suspicious — callers should treat that as a 401.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleIdentity> {
  const projectId = firebaseProjectId();
  if (!projectId) {
    throw new Error("Google sign-in is not configured (FIREBASE_PROJECT_ID missing).");
  }

  const { payload } = await jwtVerify(idToken, keySet(), {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
    clockTolerance: 60, // seconds, for modest clock skew
  });

  const uid = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!uid) throw new Error("Token has no subject.");
  if (!email) throw new Error("Token carries no email address.");

  return {
    uid,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
    emailVerified: payload.email_verified === true,
  };
}
