import { assessIndependence, type IndependenceReport } from "./independence";
import { verifyClaims, type ClaimReport } from "./claims";
import { fetchPageText, mapLimit } from "./page";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Checking somebody else's answer.
//
// Nothing in the verification stack cares where the text came from. It takes a
// passage with [n] markers and a list of URLs, and asks whether the URLs exist,
// whether the sentences are in them, and how many independent voices they
// really are. A briefing this app produced satisfies that description. So does
// an answer someone pasted out of ChatGPT.
//
// Pointing the same machinery outward is the whole feature, and it changes what
// the product is: not another tool competing to generate research, but the one
// that audits it. That position is empty, and it is empty because auditing
// requires infrastructure — fetching, embedding, calibration — that a prompt
// cannot substitute for.
//
// Two things are deliberately NOT checked here that are checked internally.
// Title relevance needs a title the citation was published under, and a pasted
// list of bare URLs has none; asking whether a page matches its own <title> is
// a tautology. And drift needs a previous fingerprint, which a first-time check
// by definition does not have.
// ---------------------------------------------------------------------------

/** Most URLs one check will open. Each is a request to somebody else's server. */
export const MAX_SOURCES = 12;
/** Longest answer accepted, in characters. Comfortably past any chat response. */
export const MAX_TEXT = 20_000;

const CONCURRENCY = 4;

export type SourceStatus = "reachable" | "dead" | "blocked" | "unreadable";

export interface ExternalSource {
  id: number;
  url: string;
  status: SourceStatus;
  /** HTTP status, when the server answered at all. */
  httpStatus: number | null;
  note: string;
}

export interface ExternalReport {
  sources: ExternalSource[];
  /** Share of the given URLs that resolved. */
  reachableRatio: number;
  claims: ClaimReport;
  independence: IndependenceReport;
  /** URLs that were dropped before checking, with why. */
  rejected: Array<{ url: string; why: string }>;
  checkedAt: number;
}

/**
 * Normalise and vet the URL list.
 *
 * Runs before anything is fetched so a paste full of junk fails immediately and
 * cheaply, rather than one slow timeout at a time. Duplicates collapse rather
 * than being rejected: pasting the same source twice is a mistake worth
 * silently fixing, not worth an error message.
 */
export function prepareSources(raw: string[]): {
  citations: Citation[];
  rejected: Array<{ url: string; why: string }>;
} {
  const citations: Citation[] = [];
  const rejected: Array<{ url: string; why: string }> = [];
  const seen = new Set<string>();

  for (const line of raw) {
    const url = line.trim();
    if (!url) continue;

    if (citations.length >= MAX_SOURCES) {
      rejected.push({ url, why: `Only the first ${MAX_SOURCES} sources are checked.` });
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      rejected.push({ url, why: "Not a URL." });
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      rejected.push({ url, why: "Only http and https can be checked." });
      continue;
    }

    const key = parsed.toString().replace(/#.*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      id: citations.length + 1,
      // The page's own title would be circular to check against, so the source
      // is identified by host — enough for a reader to recognise it in a list.
      title: parsed.hostname.replace(/^www\./, ""),
      url: parsed.toString(),
      source: parsed.hostname.replace(/^www\./, ""),
    });
  }

  return { citations, rejected };
}

/**
 * Check an answer that was written somewhere else.
 *
 * Each source is opened exactly once and the text is handed to both the claim
 * check and the independence check, so a twelve-source answer costs twelve
 * requests rather than twenty-four.
 */
export async function verifyExternal(input: {
  text: string;
  urls: string[];
}): Promise<ExternalReport> {
  const { citations, rejected } = prepareSources(input.urls);
  const text = input.text.slice(0, MAX_TEXT);

  const fetched = await mapLimit(citations, CONCURRENCY, async (citation) => ({
    citation,
    page: await fetchPageText(citation.url),
  }));

  const pages = new Map<number, string>();
  const sources: ExternalSource[] = fetched.map(({ citation, page }) => {
    if (page.text) pages.set(citation.id, page.text);

    // A refusal by our own address guard is not the source's failure, and
    // reporting it as a dead link would blame the wrong party.
    const blocked =
      !page.ok && page.status === null && /public internet|standard web ports|http and https/i.test(page.error ?? "");

    const status: SourceStatus = blocked
      ? "blocked"
      : !page.ok
        ? "dead"
        : page.text
          ? "reachable"
          : "unreadable";

    return {
      id: citation.id,
      url: citation.url,
      status,
      httpStatus: page.status,
      note: page.error ?? "Fetched and read.",
    };
  });

  const reachable = sources.filter((s) => s.status === "reachable" || s.status === "unreadable").length;

  const [claims, independence] = [
    await verifyClaims({ markdown: text, citations, pages }),
    assessIndependence(
      fetched.map(({ citation, page }) => ({ citation, text: page.text ?? "" })),
    ),
  ];

  return {
    sources,
    reachableRatio: sources.length === 0 ? 0 : Number((reachable / sources.length).toFixed(2)),
    claims,
    independence,
    rejected,
    checkedAt: Date.now(),
  };
}
