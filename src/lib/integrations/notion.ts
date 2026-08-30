import { publicUrl } from "@/lib/http/origin";
import { markdownToBlocks, MAX_BLOCKS_PER_REQUEST } from "./notion-blocks";

export { markdownToBlocks } from "./notion-blocks";

// ---------------------------------------------------------------------------
// Notion integration.
//
// OAuth, then push a brief in as a real page. The Notion API takes *block
// objects*, not markdown, so the brief is converted here — headings become
// headings, lists become lists, and links stay clickable, rather than arriving
// as one undifferentiated paragraph.
// ---------------------------------------------------------------------------

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";


export function isNotionConfigured(): boolean {
  return !!process.env.NOTION_CLIENT_ID && !!process.env.NOTION_CLIENT_SECRET;
}

export async function notionRedirectUri(): Promise<string> {
  return publicUrl("/api/integrations/notion/callback");
}

export async function notionAuthorizeUrl(state: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID!,
    response_type: "code",
    // `user` rather than `workspace`: the person picks exactly which pages we
    // may touch, so a connection can't reach their whole workspace.
    owner: "user",
    redirect_uri: await notionRedirectUri(),
    state,
  });
  return `${API}/oauth/authorize?${params}`;
}

export interface NotionToken {
  accessToken: string;
  workspaceName: string;
  workspaceId: string;
}

/** Exchange the callback code for a token. Notion tokens do not expire. */
export async function exchangeNotionCode(code: string): Promise<NotionToken> {
  const basic = Buffer.from(
    `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: await notionRedirectUri(),
    }),
  });

  if (!res.ok) {
    // Never surface the body: it can echo the client secret back.
    console.error("Notion token exchange failed:", res.status);
    throw new Error("Notion rejected the authorization. Try connecting again.");
  }

  const data = (await res.json()) as {
    access_token: string;
    workspace_name?: string;
    workspace_id?: string;
  };
  return {
    accessToken: data.access_token,
    workspaceName: data.workspace_name ?? "Notion",
    workspaceId: data.workspace_id ?? "",
  };
}

// --- Creating the page -----------------------------------------------------

/** A page the connection is allowed to write to, to parent the new page under. */
async function findParentPage(accessToken: string): Promise<string | null> {
  const res = await fetch(`${API}/search`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      page_size: 1,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { id: string }[] };
  return data.results?.[0]?.id ?? null;
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Notion-Version": VERSION,
});

export async function createNotionPage(input: {
  accessToken: string;
  title: string;
  markdown: string;
}): Promise<{ url: string }> {
  const parentId = await findParentPage(input.accessToken);
  if (!parentId) {
    throw new Error(
      "No Notion page is shared with Scrutan. Re-connect and tick at least one page when Notion asks which to share.",
    );
  }

  const blocks = markdownToBlocks(input.markdown);

  const res = await fetch(`${API}/pages`, {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ type: "text", text: { content: input.title.slice(0, 200) } }] },
      },
      // The first 100 blocks go with the page; the rest are appended below.
      children: blocks.slice(0, MAX_BLOCKS_PER_REQUEST),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Notion page create failed:", res.status, detail.slice(0, 200));
    throw new Error("Notion refused to create the page. Try reconnecting.");
  }

  const page = (await res.json()) as { id: string; url?: string };

  // Append the remainder in 100-block batches. A failure here leaves a partial
  // page rather than none, which is the better outcome — so it's logged, not
  // thrown.
  for (let i = MAX_BLOCKS_PER_REQUEST; i < blocks.length; i += MAX_BLOCKS_PER_REQUEST) {
    const chunk = blocks.slice(i, i + MAX_BLOCKS_PER_REQUEST);
    const append = await fetch(`${API}/blocks/${page.id}/children`, {
      method: "PATCH",
      headers: authHeaders(input.accessToken),
      body: JSON.stringify({ children: chunk }),
    });
    if (!append.ok) {
      console.error("Notion append failed at block", i, append.status);
      break;
    }
  }

  return { url: page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}` };
}
