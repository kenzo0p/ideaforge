"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject, isProjectOwner, restoreVersion } from "@/lib/db/projects";
import { getVersion, listVersions, type VersionSummary } from "@/lib/db/versions";
import { diffLines, diffPlans, diffResearch, type LineDiff, type PlanDiff, type ResearchDiff } from "@/lib/versions/diff";

// ---------------------------------------------------------------------------
// History server actions.
//
// Reads are open to anyone with project access — a collaborator should see how
// the work got here. Restoring is the owner's alone: it rewrites the shared
// artifacts, and a teammate undoing someone's regeneration is not a resolution
// anyone asked for.
// ---------------------------------------------------------------------------

export interface VersionState {
  error?: string;
  ok?: boolean;
}

export async function listVersionsAction(projectId: string): Promise<VersionSummary[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!(await getProject(projectId, user.id))) return [];
  return listVersions(projectId);
}

export interface VersionComparison {
  validation: LineDiff | null;
  plan: PlanDiff | null;
  research: ResearchDiff | null;
  versionAt: number;
}

/** Compare one stored version against what the project looks like now. */
export async function compareWithCurrentAction(
  projectId: string,
  versionId: string,
): Promise<VersionComparison | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const version = await getVersion(projectId, versionId);
  if (!version) return { error: "That version is no longer available." };

  return {
    // Direction is old → new, so "added" means the current version has it and
    // the old one didn't. The reverse reads backwards to everyone.
    validation:
      version.validationMarkdown || project.validationMarkdown
        ? diffLines(version.validationMarkdown ?? "", project.validationMarkdown ?? "")
        : null,
    plan: diffPlans(version.plan, project.plan),
    research: diffResearch(version.research, project.research),
    versionAt: version.createdAt,
  };
}

export async function restoreVersionAction(
  projectId: string,
  versionId: string,
): Promise<VersionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  if (!(await isProjectOwner(projectId, user.id))) {
    return { error: "Only the project owner can restore a version." };
  }

  const done = await restoreVersion(projectId, user.id, versionId);
  if (!done) return { error: "That version is no longer available." };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
