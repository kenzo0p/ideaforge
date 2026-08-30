// ---------------------------------------------------------------------------
// Fetching a cited page, once, for everything that needs to read it.
//
// Two features now open the same URLs: the citation check (does this resolve,
// and is it about what it was cited as?) and the claim check (does it actually
// say this?). They must agree on how we identify ourselves, how long we wait
// and how much we read — otherwise a source is "reachable" to one and dead to
// the other, and the product contradicts itself about its own evidence.
// ---------------------------------------------------------------------------

/**
 * Identify ourselves honestly.
 *
 * We are a bot fetching pages we were told about. Pretending to be a browser
 * to get around blocks would be dishonest and would break the moment anyone
 * looked at their logs.
 */
export const USER_AGENT =
  "ScrutanCitationCheck/1.0 (+verifies that cited sources resolve; contact via the site)";

export const TIMEOUT_MS = 8000;
export const MAX_BODY_BYTES = 400_000;

/** Crude tag strip. Enough to ask "does this page mention these words?". */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .toLowerCase();
}

/**
 * Readable text with the surrounding furniture removed.
 *
 * Case is preserved, unlike `visibleText`. The citation check only asks whether
 * words appear, so it can lowercase everything; a passage shown to a reader as
 * the evidence for a claim cannot be, and an embedder handles real prose better
 * than a lowercased smear.
 */
export function readableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&[a-z]+;/gi, " ");
}

export interface FetchedPage {
  ok: boolean;
  status: number | null;
  contentType: string;
  /** Readable text, or "" when there was nothing to read. */
  text: string;
  /** Set when the page could not be read; the reason, for an operator. */
  error: string | null;
}

/**
 * Fetch one page and return its readable text.
 *
 * Never throws. Every caller here is checking many URLs, and one host that
 * hangs up must not abort the pass — the failure is data, not an exception.
 */
export async function fetchPageText(url: string): Promise<FetchedPage> {
  const miss = (error: string, status: number | null = null): FetchedPage => ({
    ok: false,
    status,
    contentType: "",
    text: "",
    error,
  });

  if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(url ?? "")) return miss("Not a valid URL.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ...miss(`Server returned ${res.status}.`, res.status), contentType };

    // A PDF that returns 200 is a real source; we simply cannot read its words
    // here. Reported as reachable-but-unreadable rather than as a failure.
    if (!contentType.includes("html")) {
      return {
        ok: true,
        status: res.status,
        contentType,
        text: "",
        error: `Reachable (${contentType.split(";")[0] || "unknown type"}); not text-readable.`,
      };
    }

    const body = (await res.text()).slice(0, MAX_BODY_BYTES);
    return { ok: true, status: res.status, contentType, text: readableText(body), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted = /abort/i.test(message);
    return miss(aborted ? `No response within ${TIMEOUT_MS / 1000}s.` : message.slice(0, 120));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `work` over `items` with a bounded number in flight.
 *
 * Shared because both checks fan out to other people's servers, and firing
 * twenty simultaneous requests at one domain because a report happened to cite
 * it twenty times would be rude and would get us blocked.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const queue = items.map((item, i) => ({ item, i }));
  const out = new Array<R>(items.length);
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      out[next.i] = await work(next.item);
    }
  });
  await Promise.all(workers);
  return out;
}
