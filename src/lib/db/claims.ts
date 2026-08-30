import { col } from "./index";
import type { ClaimReport } from "@/lib/verify/claims";

// ---------------------------------------------------------------------------
// Stored claim-level verification.
//
// Kept apart from `groundingReports` even though the two describe the same
// briefing, because they are produced at different times, at very different
// costs, and answer different questions. Folding them into one document would
// mean either recomputing the expensive one whenever the cheap one runs, or
// storing a document where half the fields are silently out of date.
//
// One report per project: the claims it describes are replaced wholesale
// whenever research is re-run, so an older report describes a briefing that no
// longer exists.
// ---------------------------------------------------------------------------

interface ClaimDoc extends ClaimReport {
  _id: string; // projectId
  userId: string;
}

const claims = () => col<ClaimDoc>("claimReports");

export async function saveClaims(
  projectId: string,
  userId: string,
  report: ClaimReport,
): Promise<void> {
  await (await claims()).replaceOne({ _id: projectId }, { ...report, userId }, { upsert: true });
}

export async function getClaims(projectId: string): Promise<ClaimReport | null> {
  const d = await (await claims()).findOne({ _id: projectId });
  if (!d) return null;
  const { _id, userId, ...report } = d;
  void _id;
  void userId;
  return report;
}

/** Headline numbers only, for listing surfaces. */
export interface ClaimSummary {
  supportScore: number;
  supported: number;
  checked: number;
  checkedAt: number;
}

export async function getClaimScores(
  projectIds: string[],
): Promise<Record<string, ClaimSummary>> {
  if (projectIds.length === 0) return {};
  const docs = await (await claims())
    .find(
      { _id: { $in: projectIds } },
      { projection: { supportScore: 1, supported: 1, verdicts: 1, unavailable: 1, checkedAt: 1 } },
    )
    .toArray();

  const out: Record<string, ClaimSummary> = {};
  for (const d of docs) {
    out[d._id] = {
      supportScore: d.supportScore,
      supported: d.supported,
      // The denominator the score was computed against, not the raw count —
      // otherwise a card and its project page would show different fractions.
      checked: (d.verdicts?.length ?? 0) - (d.unavailable ?? 0),
      checkedAt: d.checkedAt,
    };
  }
  return out;
}

export async function purgeClaims(projectId: string): Promise<void> {
  await (await claims()).deleteMany({ _id: projectId });
}
