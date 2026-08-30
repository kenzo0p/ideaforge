import { publicUrl } from "@/lib/http/origin";

// ---------------------------------------------------------------------------
// Google Docs integration.
//
// The Docs API can only build a document by replaying edit operations, which
// would mean reimplementing the whole brief a second time. Drive will instead
// *convert* an uploaded .docx into a native Google Doc in one call — and we
// already generate that .docx for the download button. One format, two
// destinations, no duplicated layout code.
//
// Scope is drive.file: access limited to files this app created. It cannot read
// anything else in the user's Drive, which is the least privilege that does the
// job — and the difference between an easy and an impossible consent screen.
// ---------------------------------------------------------------------------

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export function isGoogleDocsConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export async function googleRedirectUri(): Promise<string> {
  return publicUrl("/api/integrations/google/callback");
}

export async function googleAuthorizeUrl(state: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: await googleRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    // Needed to get a refresh token at all; without `consent` Google returns
    // one only on the very first authorization, so a reconnect would silently
    // produce a connection that dies in an hour.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${params}`;
}

export interface GoogleToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email: string;
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });
  if (!res.ok) {
    // Body can echo the client secret; log only the status.
    console.error("Google token request failed:", res.status);
    throw new Error("Google rejected the authorization. Try connecting again.");
  }
  return res.json();
}

export async function exchangeGoogleCode(code: string): Promise<GoogleToken> {
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: await googleRedirectUri(),
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: await fetchEmail(data.access_token),
  };
}

/**
 * Label the connection with something recognisable.
 *
 * drive.file doesn't grant profile access, so this reads the token's own
 * metadata instead. Best-effort: a missing label must not fail the connection.
 */
async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
    if (!res.ok) return "Google Drive";
    const info = (await res.json()) as { email?: string };
    return info.email ?? "Google Drive";
  } catch {
    return "Google Drive";
  }
}

/** Swap a refresh token for a fresh access token. */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Upload a .docx and have Drive convert it to a native Google Doc.
 *
 * `mimeType: application/vnd.google-apps.document` on the metadata is what
 * triggers conversion; without it the file lands as an uneditable .docx
 * attachment in Drive.
 */
export async function createGoogleDoc(input: {
  accessToken: string;
  title: string;
  docx: Buffer;
}): Promise<{ url: string }> {
  const boundary = `scrutan-${Date.now()}`;
  const metadata = JSON.stringify({
    name: input.title.slice(0, 200),
    mimeType: "application/vnd.google-apps.document",
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ),
    input.docx,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Google Drive upload failed:", res.status, detail.slice(0, 200));
    throw new Error("Google Drive refused the upload. Try reconnecting.");
  }

  const file = (await res.json()) as { id: string; webViewLink?: string };
  return { url: file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit` };
}
