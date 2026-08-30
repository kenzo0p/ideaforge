"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject } from "@/lib/db/projects";
import { membershipFor } from "@/lib/db/orgs";
import { listOrgMembers } from "@/lib/db/orgs";
import { findSimilarIdeas, countIndexed, type SimilarIdea } from "@/lib/db/similar";
import { verifyCitations } from "@/lib/verify/citations";
import { getGrounding, saveGrounding, type StoredGrounding } from "@/lib/db/grounding";
import { verifyClaims, type ClaimReport } from "@/lib/verify/claims";
import { getClaims, saveClaims } from "@/lib/db/claims";
import { getSnapshots, saveSnapshots } from "@/lib/db/snapshots";
import { detectDrift, fingerprint, type CapturedPage, type SourceDrift } from "@/lib/verify/evidence";
import { assessIndependence } from "@/lib/verify/independence";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// The two verification surfaces.
//
// Both are reads over things the user already has access to, and both are
// scoped from the session rather than from anything the browser sent.
// ---------------------------------------------------------------------------

/**
 * Ideas resembling this one, within the user's own workspace.
 *
 * Scope is the whole point. Searching globally would leak one institution's
 * unpublished project ideas to another, so the candidate set is built from the
 * workspace roster — and from nobody else when there is no workspace.
 */
export async function similarIdeasAction(
  text: string,
  excludeProjectId?: string,
): Promise<{ results: SimilarIdea[]; corpusSize: number; scope: "workspace" | "personal" }> {
  const user = await getCurrentUser();
  if (!user) return { results: [], corpusSize: 0, scope: "personal" };

  const clean = text.trim();
  if (clean.length < 12) return { results: [], corpusSize: 0, scope: "personal" };

  const membership = await membershipFor(user.id);

  // Without a workspace there is nothing to compare against but your own past
  // ideas, which is still useful — people re-propose their own ideas too.
  let userIds = [user.id];
  let scope: "workspace" | "personal" = "personal";

  if (membership) {
    const members = await listOrgMembers(membership.org.id);
    userIds = members.map((m) => m.userId);
    scope = "workspace";
  }

  const [results, corpusSize] = await Promise.all([
    findSimilarIdeas({ text: clean, userIds, excludeProjectId }),
    countIndexed(userIds),
  ]);

  return { results, corpusSize, scope };
}

/**
 * Fetch every cited source and report which ones actually hold up.
 *
 * Owner-or-collaborator only: it makes a burst of outbound requests, and an
 * unauthenticated endpoint that fetches arbitrary URLs on request is an open
 * proxy. The URLs come from the stored report, never from the caller.
 */
export async function verifyCitationsAction(
  projectId: string,
): Promise<{ report?: StoredGrounding; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const citations = project.research?.citations ?? [];
  if (citations.length === 0) return { error: "This project has no citations to check yet." };

  // Captured on the way past: one fetch serves both the verdict and the
  // fingerprint comparison.
  const pages: CapturedPage[] = [];
  const report = await verifyCitations(citations, (citation, text) => {
    pages.push({ citation, text });
  });

  const drift = await compareEvidence(projectId, user.id, pages);
  const independence = assessIndependence(readSourcesOf(citations, pages));

  // Storing is also what computes the comparison against the last check, so a
  // storage failure costs the decay record, not the result. Show it anyway,
  // with an empty history rather than a fabricated one.
  const stored = await saveGrounding(projectId, user.id, report, drift, independence).catch((err) => {
    console.error("Could not store grounding report:", err instanceof Error ? err.message : err);
    return null;
  });

  revalidatePath(`/projects/${projectId}`);
  return {
    report:
      stored ?? {
        ...report,
        history: [],
        rotted: [],
        firstCheckedAt: report.checkedAt,
        drift,
        independence,
      },
  };
}

/**
 * Pair every citation with whatever text was read for it.
 *
 * Citations whose page could not be fetched are included with empty text rather
 * than dropped: a publisher is identifiable from a URL alone, so a source that
 * would not load still counts towards concentration. Silently omitting it would
 * make a briefing look more diverse the more of its sources were broken.
 */
function readSourcesOf(citations: Citation[], pages: CapturedPage[]) {
  const text = new Map(pages.map((p) => [p.citation.id, p.text]));
  return citations.map((citation) => ({ citation, text: text.get(citation.id) ?? "" }));
}

/**
 * Fingerprint the pages just read and report what moved since last time.
 *
 * Never throws: this is an enhancement to the citation check, and a failure to
 * compare fingerprints must not cost the user the verdicts they asked for.
 */
async function compareEvidence(
  projectId: string,
  userId: string,
  pages: CapturedPage[],
): Promise<SourceDrift[]> {
  if (pages.length === 0) return [];
  try {
    const [previous, claims] = await Promise.all([
      getSnapshots(projectId),
      getClaims(projectId),
    ]);
    const drift = detectDrift({ pages, previous, claims: claims?.verdicts ?? [] });
    await saveSnapshots(projectId, userId, pages.map((page) => fingerprint(projectId, page)));
    return drift;
  } catch (err) {
    console.error("Evidence comparison failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** The last stored verification, so the page can render without re-fetching. */
export async function groundingAction(projectId: string): Promise<StoredGrounding | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await getProject(projectId, user.id))) return null;
  return getGrounding(projectId);
}


/**
 * Check whether the cited sources actually say what the briefing says they say.
 *
 * The heavier sibling of `verifyCitationsAction`: it opens the same URLs but
 * also reads them, chunks them and embeds them, so it is gated the same way and
 * for the same reason — the URLs come from the stored report, never from the
 * caller, and an unauthenticated endpoint that fetches arbitrary URLs on demand
 * is an open proxy.
 */
export async function verifyClaimsAction(
  projectId: string,
): Promise<{ report?: ClaimReport; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const research = project.research;
  if (!research?.summaryMarkdown) {
    return { error: "This project has no research to check yet." };
  }
  if ((research.citations?.length ?? 0) === 0) {
    return { error: "The briefing cites no sources, so there is nothing to check it against." };
  }

  let report: ClaimReport;
  try {
    report = await verifyClaims({
      markdown: research.summaryMarkdown,
      citations: research.citations,
    });
  } catch (err) {
    // The embedder needs a few hundred MB and a model download on first use. A
    // deployment that cannot provide either should say so plainly rather than
    // present an empty report as a clean bill of health.
    console.error("Claim check failed:", err instanceof Error ? err.message : err);
    return { error: "Could not check the claims — the text model is unavailable on this deployment." };
  }

  await saveClaims(projectId, user.id, report).catch((err) => {
    console.error("Could not store claim report:", err instanceof Error ? err.message : err);
  });

  revalidatePath(`/projects/${projectId}`);
  return { report };
}

/** The last stored claim check, so the page can render without recomputing. */
export async function claimsAction(projectId: string): Promise<ClaimReport | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await getProject(projectId, user.id))) return null;
  return getClaims(projectId);
}
