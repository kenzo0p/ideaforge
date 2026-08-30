import type { GroundingReport } from "./citations";
import type { ClaimReport } from "./claims";

// ---------------------------------------------------------------------------
// How a grounding score is described, in one place.
//
// The score appears on the project page, on a public brief, on a dashboard
// card and inside a link-preview image — four renderers, two of which cannot
// read a stylesheet. If each decided for itself where "strong" ended, the same
// brief would be described differently depending on where you saw it, which is
// exactly the kind of inconsistency that makes a trust signal untrustworthy.
//
// So the thresholds, the words and the colours live here, and the colours are
// duplicated as hex because the OG image renders outside the document.
// ---------------------------------------------------------------------------

export type GroundingBand = "strong" | "mixed" | "weak" | "unchecked";

/**
 * Where the bands sit.
 *
 * 0.8 is not arbitrary. A briefing usually cites eight to fourteen sources, so
 * one bad citation in ten still lands in `strong` — a single paywalled page
 * should not demote an otherwise sound report. Below half the sources holding
 * up, the report is not evidence any more, and the word for that is `weak`.
 */
const STRONG = 0.8;
const MIXED = 0.5;

export function groundingBand(score: number | null | undefined): GroundingBand {
  if (score === null || score === undefined) return "unchecked";
  if (score >= STRONG) return "strong";
  if (score >= MIXED) return "mixed";
  return "weak";
}

/** Short label for a pill. Reads as a verdict on the evidence, not on the idea. */
export const BAND_LABEL: Record<GroundingBand, string> = {
  strong: "Well grounded",
  mixed: "Partly grounded",
  weak: "Poorly grounded",
  unchecked: "Sources unchecked",
};

/** Tailwind classes, for everything that renders inside the document. */
export const BAND_CLASS: Record<GroundingBand, string> = {
  strong: "border-success/40 bg-success/10 text-success",
  mixed: "border-warning/40 bg-warning/10 text-warning",
  weak: "border-danger/40 bg-danger/10 text-danger",
  unchecked: "border-border bg-surface text-muted",
};

/** The same colours as hex, for the OG image, which has no CSS variables. */
export const BAND_HEX: Record<GroundingBand, string> = {
  strong: "#177f7f",
  mixed: "#9a6b1f",
  weak: "#a13333",
  unchecked: "#5b6b6b",
};

/**
 * One sentence a stranger can act on.
 *
 * Deliberately states the denominator. "92% grounded" invites the reader to
 * assume a large sample; "11 of 12 sources" tells them it was twelve, which is
 * the number they actually need to judge how much the percentage means.
 */
export function groundingSentence(report: GroundingReport): string {
  const total = report.verdicts.length;
  if (total === 0) return "No sources were cited.";
  const failed = total - report.verified;
  const opened = `${report.verified} of ${total} cited ${total === 1 ? "source" : "sources"} opened and matched what it was cited for`;
  return failed === 0 ? `Every one of the ${total} cited sources checked out.` : `${opened}.`;
}

/** Percentage, rounded once so every surface shows the same integer. */
export function groundingPercent(score: number): number {
  return Math.round(score * 100);
}


// ---------------------------------------------------------------------------
// Claim support uses the same bands as citation grounding.
//
// Both numbers answer "what fraction of this held up when we checked?", so
// giving them different cut-offs would mean 78% meant one thing beside the
// citations and another beside the claims, on the same page. Only the wording
// differs, because what was checked differs.
// ---------------------------------------------------------------------------

export const CLAIM_BAND_LABEL: Record<GroundingBand, string> = {
  strong: "Well supported",
  mixed: "Partly supported",
  weak: "Poorly supported",
  unchecked: "Claims unchecked",
};

/**
 * One sentence about what the claim check found.
 *
 * Leads with the failures when there are any. "9 of 12 supported" and "3 claims
 * are not in their sources" are the same fact, but only the second one gets
 * acted on, and the second one is the reason to run this at all.
 */
export function claimSentence(report: ClaimReport): string {
  const checked = report.verdicts.length - report.unavailable;
  if (checked === 0) return "No claim could be checked against a readable source.";

  const missing = report.unsupported;
  const parts: string[] = [
    `${report.supported} of ${checked} checked ${checked === 1 ? "claim is" : "claims are"} stated by a passage in the source cited for it`,
  ];
  if (missing > 0) {
    parts.push(
      `${missing} ${missing === 1 ? "is" : "are"} not in ${missing === 1 ? "its" : "their"} cited ${missing === 1 ? "source" : "sources"} at all`,
    );
  }
  if (report.uncited > 0) {
    parts.push(`${report.uncited} ${report.uncited === 1 ? "figure is" : "figures are"} asserted with no citation`);
  }
  return `${parts.join("; ")}.`;
}
