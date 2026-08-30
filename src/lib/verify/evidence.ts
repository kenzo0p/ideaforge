import { contentHash, passageSurvives, shingles, sketch, similarity } from "./shingle";
import type { Snapshot } from "@/lib/db/snapshots";
import type { ClaimVerdict } from "./claims";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// What happened to the evidence.
//
// The decay pass already reports the sources that stopped resolving. The
// failure it cannot see is the more common one: the page is still up, still
// returns 200, still carries its title — and the paragraph the briefing cited
// is no longer in it. A statistic gets corrected, a news story is rewritten in
// place, a vendor quietly drops a claim from its own marketing. Every check in
// this codebase passes afterwards.
//
// Comparing the page against its fingerprint answers two different questions,
// and the second is the one worth interrupting someone for:
//
//   how much of the page changed   — from the MinHash sketch
//   whether *your* passage survived — from the claim check's own quotations
//
// A page can be almost entirely rewritten and still contain the sentence you
// cited, in which case nothing is wrong. A page can be barely touched and have
// lost precisely the line that mattered. Reporting only the first number would
// bury the finding under noise.
// ---------------------------------------------------------------------------

export type DriftKind =
  /** Byte-for-byte the same text, after normalisation. */
  | "unchanged"
  /** Changed, but recognisably the same document. */
  | "edited"
  /** So little survives that it is effectively a different page. */
  | "rewritten"
  /** Could not be read this time, so nothing can be said about drift. */
  | "unreadable"
  /** First time we have seen this source; there is nothing to compare against. */
  | "new";

export interface SourceDrift {
  citationId: number;
  url: string;
  kind: DriftKind;
  /** Estimated share of the page that survived, 0–1. Null when not comparable. */
  similarity: number | null;
  /**
   * Claims whose supporting passage is no longer in the page.
   *
   * The headline finding. A non-empty list means the briefing now cites a
   * source that no longer says what it was cited for.
   */
  lostClaims: Array<{ index: number; text: string }>;
  capturedAt: number;
}

/**
 * Above this, the page is recognisably the document we read before.
 *
 * Set from measurement rather than taste: on 5-word shingles, adding a full
 * navigation and footer to an article leaves similarity near 0.89, deleting a
 * whole paragraph lands near 0.58, and a genuine rewrite on the same subject
 * scores 0.00 — five consecutive words rarely survive a rewrite. There is a
 * wide empty gap between "edited" and "rewritten", so the exact cut-off inside
 * it changes very little.
 */
const RECOGNISABLE = 0.35;

export interface CapturedPage {
  citation: Citation;
  text: string;
}

/** Fingerprint a page as it is now. */
export function fingerprint(projectId: string, page: CapturedPage): Snapshot {
  const words = page.text.trim().split(/\s+/).filter(Boolean).length;
  return {
    projectId,
    citationId: page.citation.id,
    url: page.citation.url,
    contentHash: contentHash(page.text),
    sketch: sketch(shingles(page.text)),
    words,
    capturedAt: Date.now(),
  };
}

/**
 * Compare what was just read against what was stored.
 *
 * `claims` are the verdicts from the last claim check. Only the passages that
 * actually supported something are looked for: a passage from an unsupported
 * claim was never evidence, so its disappearance is not a loss.
 */
export function detectDrift(input: {
  pages: CapturedPage[];
  previous: Snapshot[];
  claims: ClaimVerdict[];
}): SourceDrift[] {
  const before = new Map(input.previous.map((s) => [s.citationId, s]));

  return input.pages.map((page) => {
    const id = page.citation.id;
    const prior = before.get(id);
    const base = { citationId: id, url: page.citation.url };

    if (!prior) {
      return { ...base, kind: "new" as const, similarity: null, lostClaims: [], capturedAt: 0 };
    }

    const now = shingles(page.text);
    const score = similarity(prior.sketch, sketch(now));
    const identical = contentHash(page.text) === prior.contentHash;

    // Only claims this source supported, and only ones with a quotation to
    // look for. An unsupported claim had no passage to lose.
    const lostClaims = input.claims
      .filter(
        (c) =>
          c.sourceId === id &&
          c.passage &&
          (c.kind === "supported" || c.kind === "weak") &&
          !passageSurvives(c.passage, now),
      )
      .map((c) => ({ index: c.index, text: c.text }));

    return {
      ...base,
      kind: identical ? "unchanged" : score >= RECOGNISABLE ? "edited" : "rewritten",
      similarity: score,
      lostClaims,
      capturedAt: prior.capturedAt,
    };
  });
}

/** One sentence for a notification, or null when nothing is worth sending. */
export function driftMessage(projectTitle: string, drift: SourceDrift[]): string | null {
  const lost = drift.filter((d) => d.lostClaims.length > 0);
  const rewritten = drift.filter((d) => d.kind === "rewritten" && d.lostClaims.length === 0);

  if (lost.length > 0) {
    const claims = lost.reduce((n, d) => n + d.lostClaims.length, 0);
    return (
      `${claims} ${claims === 1 ? "claim" : "claims"} in "${projectTitle}" ${claims === 1 ? "cites" : "cite"} a page that is still online ` +
      `but no longer contains the passage ${claims === 1 ? "it was" : "they were"} based on.`
    );
  }
  if (rewritten.length > 0) {
    return (
      `${rewritten.length} ${rewritten.length === 1 ? "source" : "sources"} behind "${projectTitle}" ` +
      `${rewritten.length === 1 ? "has" : "have"} been substantially rewritten since the brief was verified.`
    );
  }
  // An edit that changed nothing you relied on is not news.
  return null;
}
