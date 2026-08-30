import { fetchPageText, mapLimit, visibleText } from "./page";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Verifying that citations are real.
//
// Every AI research tool *presents* citations. None of the mainstream ones
// check that their own citations resolve, which means a confidently formatted
// reference list can contain dead links and pages that never mentioned the
// claim. In a product whose whole argument is "the evidence is checkable",
// asserting that without checking it would be the same failure one level up.
//
// So each cited URL is actually fetched, and three separate things are
// established:
//
//   reachable  — the server returned a success status
//   relevant   — the page text overlaps the claimed title
//   verified   — both of the above
//
// The distinction matters. A dead link is a fabricated or rotted source; a
// reachable page that shares no vocabulary with its title is a source about
// something else. They need different responses, so they are reported apart.
// ---------------------------------------------------------------------------

export type VerdictKind =
  /** Fetched, and the page matches what it was cited as. */
  | "verified"
  /** Fetched, but the content does not resemble the cited title. */
  | "mismatch"
  /** Server said no: 404, 410, or any other error status. */
  | "dead"
  /** Could not be checked — timeout, blocked, or a login wall. */
  | "unreachable";

export interface CitationVerdict {
  id: number;
  url: string;
  title: string;
  kind: VerdictKind;
  status: number | null;
  /** Fraction of the title's distinctive words found on the page, 0–1. */
  overlap: number | null;
  /** Operator-facing detail; never a reason to alarm a reader. */
  note: string;
  checkedAt: number;
}

export interface GroundingReport {
  verdicts: CitationVerdict[];
  /** Share of citations that fetched *and* matched. The headline number. */
  groundingScore: number;
  verified: number;
  mismatch: number;
  dead: number;
  unreachable: number;
  checkedAt: number;
}

const CONCURRENCY = 4;

/**
 * Called with the readable text of each page that was successfully fetched.
 *
 * Exists so a page is opened once. Citation verification and evidence
 * fingerprinting both need the same bytes, and fetching twice would double the
 * load we put on other people's servers to answer two halves of one question.
 */
export type OnPage = (citation: Citation, text: string) => void | Promise<void>;

/** Words too common to prove a page is about anything. */
const STOP = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "by",
  "with", "from", "that", "this", "is", "are", "was", "were", "be", "as",
  "how", "why", "what", "when", "using", "use", "new", "your", "you", "it",
  "its", "their", "our", "we", "can", "will", "into", "about", "more",
]);

function distinctiveWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w)),
    ),
  ];
}

/**
 * Overlap high enough to call a page relevant to its title.
 *
 * Deliberately forgiving. A real source often phrases its own title
 * differently from how it was cited, and the cost of a false "mismatch" —
 * telling a student a good source is wrong — is higher than the cost of
 * missing a marginal one.
 */
const RELEVANCE_THRESHOLD = 0.3;

async function verifyOne(citation: Citation, onPage?: OnPage): Promise<CitationVerdict> {
  const base: Omit<CitationVerdict, "kind" | "status" | "overlap" | "note"> = {
    id: citation.id,
    url: citation.url,
    title: citation.title,
    checkedAt: Date.now(),
  };

  if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(citation.url ?? "")) {
    return { ...base, kind: "dead", status: null, overlap: null, note: "Not a valid URL." };
  }

  const page = await fetchPageText(citation.url);

  if (!page.ok) {
    // A status means the server answered and refused; no status means we never
    // got that far. They are different failures and are reported apart.
    return {
      ...base,
      kind: page.status === null ? "unreachable" : "dead",
      status: page.status,
      overlap: null,
      note: page.error ?? "Could not be read.",
    };
  }

  // A PDF that returns 200 is a real source; we simply can't read its words
  // here. Reporting it as a mismatch would be wrong, so relevance is skipped.
  if (!page.text) {
    return {
      ...base,
      kind: "verified",
      status: page.status,
      overlap: null,
      note: page.error ?? "Reachable; content not text-checked.",
    };
  }

  // Handed to the caller before the verdict is computed, so a feature that
  // wants the page itself — fingerprinting it, checking a passage still exists
  // — gets it without fetching the same URL a second time.
  if (onPage) await onPage(citation, page.text);

  const body = visibleText(page.text);
  const words = distinctiveWords(citation.title);
  const found = words.filter((w) => body.includes(w)).length;
  const overlap = words.length === 0 ? 1 : found / words.length;

  return {
    ...base,
    kind: overlap >= RELEVANCE_THRESHOLD ? "verified" : "mismatch",
    status: page.status,
    overlap: Number(overlap.toFixed(2)),
    note:
      overlap >= RELEVANCE_THRESHOLD
        ? `Reachable; ${found}/${words.length} title terms present.`
        : `Reachable, but only ${found}/${words.length} title terms present.`,
  };
}

/**
 * Check every citation in a report.
 *
 * Bounded concurrency: this fans out to other people's servers, and firing
 * twenty simultaneous requests at one domain because a report happened to cite
 * it twenty times would be rude and would get us blocked.
 */
export async function verifyCitations(
  citations: Citation[],
  onPage?: OnPage,
): Promise<GroundingReport> {
  const verdicts = await mapLimit(citations, CONCURRENCY, (c) => verifyOne(c, onPage));
  verdicts.sort((a, b) => a.id - b.id);

  const count = (k: VerdictKind) => verdicts.filter((v) => v.kind === k).length;
  const verified = count("verified");

  return {
    verdicts,
    // Unreachable citations count against the score. A source nobody can open
    // is not evidence, whatever the reason — and excluding them would let a
    // report full of dead paywalled links claim a perfect grounding score.
    groundingScore: verdicts.length === 0 ? 0 : Number((verified / verdicts.length).toFixed(2)),
    verified,
    mismatch: count("mismatch"),
    dead: count("dead"),
    unreachable: count("unreachable"),
    checkedAt: Date.now(),
  };
}
