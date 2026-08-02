import { randomBytes } from "node:crypto";
import { col } from "./index";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

// ---------------------------------------------------------------------------
// Connected third-party accounts (Notion, Google).
//
// One row per user per provider. Tokens are encrypted before they touch the
// database and decrypted only at the moment of use, so nothing readable is
// stored and nothing decrypted is ever returned to a caller that only needs to
// know *whether* a provider is connected.
//
// OAuth `state` values live here too, with a TTL index: they exist for the few
// seconds between redirecting a user out and their coming back.
// ---------------------------------------------------------------------------

export type Provider = "notion" | "google";

export interface Connection {
  provider: Provider;
  /** Shown in settings so people know which workspace/account is linked. */
  accountLabel: string;
  connectedAt: number;
  /** Present for Google; Notion tokens do not expire. */
  expiresAt?: number;
}

interface ConnectionDoc {
  _id: string; // `${userId}:${provider}` — one connection per provider per user
  userId: string;
  provider: Provider;
  accountLabel: string;
  accessTokenEnc: string;
  refreshTokenEnc?: string;
  /** Extra provider-specific detail (Notion workspace id, Drive folder…). */
  meta?: Record<string, string>;
  connectedAt: number;
  expiresAt?: number;
}

interface StateDoc {
  _id: string;
  userId: string;
  provider: Provider;
  /** Where to send the user once the dance completes. */
  returnTo: string;
  expiresAt: Date;
}

const connections = () => col<ConnectionDoc>("integrations");
const states = () => col<StateDoc>("oauthStates");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes is generous for a redirect

// --- OAuth state (CSRF) ----------------------------------------------------

/**
 * Mint a single-use `state` value.
 *
 * Without this an attacker can forge a callback and bind *their* Notion
 * workspace to *your* account — the classic OAuth CSRF. Tying state to the
 * session user means a callback that doesn't match is rejected.
 */
export async function createOAuthState(
  userId: string,
  provider: Provider,
  returnTo: string,
): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await (await states()).insertOne({
    _id: state,
    userId,
    provider,
    returnTo,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return state;
}

/** Consume a state value. Single use — returns null if unknown or expired. */
export async function consumeOAuthState(
  state: string,
  provider: Provider,
): Promise<{ userId: string; returnTo: string } | null> {
  const d = await (await states()).findOneAndDelete({ _id: state, provider });
  if (!d || d.expiresAt.getTime() < Date.now()) return null;
  return { userId: d.userId, returnTo: d.returnTo };
}

// --- Connections -----------------------------------------------------------

export async function saveConnection(input: {
  userId: string;
  provider: Provider;
  accountLabel: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  meta?: Record<string, string>;
}): Promise<void> {
  const doc: ConnectionDoc = {
    _id: `${input.userId}:${input.provider}`,
    userId: input.userId,
    provider: input.provider,
    accountLabel: input.accountLabel,
    accessTokenEnc: encryptToken(input.accessToken),
    ...(input.refreshToken ? { refreshTokenEnc: encryptToken(input.refreshToken) } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    connectedAt: Date.now(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  await (await connections()).replaceOne({ _id: doc._id }, doc, { upsert: true });
}

/** Safe summary for the UI — never includes a token. */
export async function listConnections(userId: string): Promise<Connection[]> {
  const docs = await (await connections()).find({ userId }).toArray();
  return docs.map((d) => ({
    provider: d.provider,
    accountLabel: d.accountLabel,
    connectedAt: d.connectedAt,
    expiresAt: d.expiresAt,
  }));
}

/** Decrypted credentials. Only call this at the point of an API request. */
export async function getCredentials(
  userId: string,
  provider: Provider,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  meta?: Record<string, string>;
} | null> {
  const d = await (await connections()).findOne({ _id: `${userId}:${provider}` });
  if (!d) return null;
  try {
    return {
      accessToken: decryptToken(d.accessTokenEnc),
      refreshToken: d.refreshTokenEnc ? decryptToken(d.refreshTokenEnc) : undefined,
      expiresAt: d.expiresAt,
      meta: d.meta,
    };
  } catch {
    // Wrong or rotated INTEGRATION_SECRET: the row is unusable, so treat it as
    // disconnected rather than crashing the export.
    console.error(`Could not decrypt ${provider} token for user — reconnect required.`);
    return null;
  }
}

/** Update just the access token after a refresh. */
export async function refreshAccessToken(
  userId: string,
  provider: Provider,
  accessToken: string,
  expiresAt: number,
): Promise<void> {
  await (await connections()).updateOne(
    { _id: `${userId}:${provider}` },
    { $set: { accessTokenEnc: encryptToken(accessToken), expiresAt } },
  );
}

export async function disconnect(userId: string, provider: Provider): Promise<void> {
  await (await connections()).deleteOne({ _id: `${userId}:${provider}` });
}
