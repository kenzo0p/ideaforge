import { col } from "./index";
import type { GroundingReport, VerdictKind } from "@/lib/verify/citations";
import type { SourceDrift } from "@/lib/verify/evidence";
import type { IndependenceReport } from "@/lib/verify/independence";

// ---------------------------------------------------------------------------
// Stored citation-verification results.
//
// Kept for two reasons. The near one: the answer survives a page reload, since
// re-fetching a dozen third-party URLs every time someone opens a project
// would be slow for them and rude to the sites being checked.
//
// The far one is the interesting one. Because the result is stored, a later
// check can be *compared* to it — and the comparison is a thing no chat-based
// tool can produce, because a chat log has no identity to come back to. A
// brief is not verified once; its evidence rots, and the record of that rotting
// is what makes the score a living number rather than a badge earned in March.
//
// One document per project — only the latest verdict set matters, because the
// citations it describes are themselves replaced whenever research is re-run.
// The history alongside it is the small, capped summary of everything before.
// ---------------------------------------------------------------------------

/** One past check, reduced to the numbers a sparkline or a sentence needs. */
export interface GroundingPoint {
  checkedAt: number;
  groundingScore: number;
  verified: number;
  total: number;
}

/** A source that used to verify and no longer does. */
export interface RottedSource {
  id: number;
  url: string;
  title: string;
  /** Always "verified" today, but stored explicitly so the record reads on its own. */
  was: VerdictKind;
  now: VerdictKind;
  /** When the change was first observed, not when the source died. */
  noticedAt: number;
}

/**
 * How many past checks to keep.
 *
 * Enough to draw a trend, few enough that the document stays small. The first
 * point is never evicted — "it was 100% when you wrote it" is the comparison
 * that makes decay legible, and losing it would silently reset the baseline.
 */
const MAX_HISTORY = 12;

export interface StoredGrounding extends GroundingReport {
  /**
   * What moved in the cited pages since the previous check.
   *
   * Stored here rather than in its own record because it is produced by the
   * same pass over the same pages: a drift result that could disagree with the
   * grounding report beside it would be a bug waiting for someone to notice.
   */
  drift: SourceDrift[];
  /**
   * How many independent voices are behind the citations.
   *
   * Alongside drift for the same reason: computed by the same pass over the
   * same pages, so it can never describe a different set of sources than the
   * verdicts beside it.
   */
  independence: IndependenceReport | null;
  /** Oldest first. The last entry describes the current verdicts. */
  history: GroundingPoint[];
  /** Sources that verified in an earlier check and stopped. Newest first. */
  rotted: RottedSource[];
  /** When this brief's sources were first checked. */
  firstCheckedAt: number;
}

interface GroundingDoc extends GroundingReport {
  _id: string; // projectId
  userId: string;
  history?: GroundingPoint[];
  rotted?: RottedSource[];
  firstCheckedAt?: number;
  drift?: SourceDrift[];
  independence?: IndependenceReport | null;
}

const grounding = () => col<GroundingDoc>("groundingReports");

function pointOf(r: GroundingReport): GroundingPoint {
  return {
    checkedAt: r.checkedAt,
    groundingScore: r.groundingScore,
    verified: r.verified,
    total: r.verdicts.length,
  };
}

/**
 * Keep the first point and the most recent ones.
 *
 * Dropping from the middle rather than the front is deliberate: the shape of
 * the decline matters less than its endpoints, and the endpoint people care
 * about is where it started.
 */
function trimHistory(points: GroundingPoint[]): GroundingPoint[] {
  if (points.length <= MAX_HISTORY) return points;
  return [points[0], ...points.slice(points.length - (MAX_HISTORY - 1))];
}

/**
 * Store a check, and work out what changed since the last one.
 *
 * The diff is by citation id *and* URL. Id alone is not enough: re-running
 * research renumbers the citations, so citation 3 in the new report can be a
 * different source entirely, and reporting that as rot would be a fabricated
 * failure — precisely the kind this product exists to catch.
 */
export async function saveGrounding(
  projectId: string,
  userId: string,
  report: GroundingReport,
  drift: SourceDrift[] = [],
  independence: IndependenceReport | null = null,
): Promise<StoredGrounding> {
  const previous = await (await grounding()).findOne({ _id: projectId });

  const priorVerified = new Map<string, number>();
  for (const v of previous?.verdicts ?? []) {
    if (v.kind === "verified") priorVerified.set(v.url, v.id);
  }

  const now = Date.now();
  const newlyRotted: RottedSource[] = report.verdicts
    .filter((v) => v.kind !== "verified" && priorVerified.has(v.url))
    .map((v) => ({
      id: v.id,
      url: v.url,
      title: v.title,
      was: "verified" as VerdictKind,
      now: v.kind,
      noticedAt: now,
    }));

  // A source that rotted, then came back (a site that was briefly down), should
  // leave the list rather than sit there as a permanent accusation.
  const stillFailing = new Set(
    report.verdicts.filter((v) => v.kind !== "verified").map((v) => v.url),
  );
  const carried = (previous?.rotted ?? []).filter(
    (r) => stillFailing.has(r.url) && !newlyRotted.some((n) => n.url === r.url),
  );

  const stored: StoredGrounding = {
    ...report,
    history: trimHistory([...(previous?.history ?? []), pointOf(report)]),
    rotted: [...newlyRotted, ...carried],
    firstCheckedAt: previous?.firstCheckedAt ?? previous?.checkedAt ?? report.checkedAt,
    // A check that captured no pages tells us nothing about drift, so the
    // previous answer stands rather than being overwritten with an empty one.
    drift: drift.length > 0 ? drift : (previous?.drift ?? []),
    independence: independence ?? previous?.independence ?? null,
  };

  await (await grounding()).replaceOne({ _id: projectId }, { ...stored, userId }, { upsert: true });
  return stored;
}

/**
 * Fill in the fields a document written before history existed does not have.
 *
 * Back-filling on read rather than with a migration keeps the two shapes from
 * having to coexist in feature code, and an old report genuinely has a history
 * of exactly one point — itself.
 */
function hydrate(d: GroundingDoc): StoredGrounding {
  const { _id, userId, history, rotted, firstCheckedAt, drift, independence, ...report } = d;
  void _id;
  void userId;
  return {
    ...report,
    history: history?.length ? history : [pointOf(report)],
    rotted: rotted ?? [],
    firstCheckedAt: firstCheckedAt ?? report.checkedAt,
    drift: drift ?? [],
    independence: independence ?? null,
  };
}

export async function getGrounding(projectId: string): Promise<StoredGrounding | null> {
  const d = await (await grounding()).findOne({ _id: projectId });
  return d ? hydrate(d) : null;
}

/** Headline numbers only, for a list of projects. */
export interface GroundingSummary {
  groundingScore: number;
  verified: number;
  total: number;
  checkedAt: number;
}

/**
 * Scores for many projects at once.
 *
 * The dashboard renders every project a user owns, so fetching one report per
 * card would be N round-trips to show N small numbers. Projected down to the
 * four fields a badge needs, so a page listing fifty projects does not pull
 * fifty full verdict lists over the wire to display fifty percentages.
 */
export async function getGroundingScores(
  projectIds: string[],
): Promise<Record<string, GroundingSummary>> {
  if (projectIds.length === 0) return {};
  const docs = await (await grounding())
    .find(
      { _id: { $in: projectIds } },
      { projection: { groundingScore: 1, verified: 1, verdicts: 1, checkedAt: 1 } },
    )
    .toArray();

  const out: Record<string, GroundingSummary> = {};
  for (const d of docs) {
    out[d._id] = {
      groundingScore: d.groundingScore,
      verified: d.verified,
      total: d.verdicts?.length ?? 0,
      checkedAt: d.checkedAt,
    };
  }
  return out;
}

/** One project's stored check, for the scheduled re-verification pass. */
export interface StaleGrounding {
  projectId: string;
  userId: string;
  stored: StoredGrounding;
}

/**
 * The checks most overdue for another look.
 *
 * Ordered oldest-first and hard-limited by the caller, because this drives
 * outbound requests to other people's servers. The staleness cut-off is what
 * bounds the total: a project re-checked today drops out of this query for
 * another month, so the work per day is the corpus divided by the interval
 * rather than the corpus times the cron frequency.
 */
export async function staleGrounding(
  olderThan: number,
  limit: number,
): Promise<StaleGrounding[]> {
  const docs = await (await grounding())
    .find({ checkedAt: { $lt: olderThan } })
    .sort({ checkedAt: 1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({ projectId: d._id, userId: d.userId, stored: hydrate(d) }));
}

export async function purgeGrounding(projectId: string): Promise<void> {
  await (await grounding()).deleteMany({ _id: projectId });
}
