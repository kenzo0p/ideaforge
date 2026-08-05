import { randomUUID } from "node:crypto";
import { col } from "./index";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Project version history.
//
// Until this existed, re-running validation on a saved project overwrote the
// previous one with a blind $set and there was no way back. That is ordinary
// use — someone reruns after editing their idea, decides the earlier verdict
// was sharper, and it is simply gone.
//
// A separate collection rather than an array on the project. Research and plan
// bodies are the two largest things the app stores, and the project document is
// read on every page load; embedding twenty copies of them would make the common
// read pay for a feature it never uses.
// ---------------------------------------------------------------------------

export type ArtifactKind = "title" | "validation" | "research" | "plan";

export interface ProjectVersion {
  id: string;
  projectId: string;
  title: string;
  validationMarkdown: string | null;
  research: ResearchReport | null;
  plan: ProjectPlan | null;
  /** Which artifacts differ from the version before this one. */
  changed: ArtifactKind[];
  createdAt: number;
}

/** Summary row for the timeline — never carries the heavy bodies. */
export interface VersionSummary {
  id: string;
  changed: ArtifactKind[];
  hasValidation: boolean;
  hasResearch: boolean;
  hasPlan: boolean;
  title: string;
  createdAt: number;
}

interface VersionDoc extends Omit<ProjectVersion, "id"> {
  _id: string;
  userId: string;
}

const versions = () => col<VersionDoc>("projectVersions");

/**
 * How many versions a project keeps.
 *
 * Uniform across plans on purpose. Charging someone to not lose work they
 * already did is the kind of pricing that costs more in goodwill than it earns.
 */
export const MAX_VERSIONS = 20;

/**
 * Two edits inside this window collapse into one version.
 *
 * Autosave fires a few hundred milliseconds after typing stops, so without
 * coalescing a single working session would leave dozens of near-identical
 * entries and bury the version anyone actually wants.
 */
const COALESCE_MS = 5 * 60 * 1000;

function toVersion(d: VersionDoc): ProjectVersion {
  const { _id, userId, ...rest } = d;
  void userId;
  return { id: _id, ...rest };
}

/** What differs between two artifact sets. */
export function diffArtifacts(
  before: Pick<ProjectVersion, "title" | "validationMarkdown" | "research" | "plan">,
  after: Pick<ProjectVersion, "title" | "validationMarkdown" | "research" | "plan">,
): ArtifactKind[] {
  const changed: ArtifactKind[] = [];
  if (before.title !== after.title) changed.push("title");
  if ((before.validationMarkdown ?? "") !== (after.validationMarkdown ?? "")) {
    changed.push("validation");
  }
  // Structural comparison by serialisation: these are plain data produced by
  // JSON.parse, so key order is stable and this is both cheap and exact enough
  // to answer "did anything change at all?".
  if (JSON.stringify(before.research ?? null) !== JSON.stringify(after.research ?? null)) {
    changed.push("research");
  }
  if (JSON.stringify(before.plan ?? null) !== JSON.stringify(after.plan ?? null)) {
    changed.push("plan");
  }
  return changed;
}

/**
 * Snapshot the state a project is about to move away from.
 *
 * Called with the *previous* contents, immediately before they are overwritten.
 * Returns false when nothing meaningful changed, which is the common case: most
 * autosaves are a re-send of identical artifacts.
 */
export async function recordVersion(input: {
  projectId: string;
  userId: string;
  previous: Pick<ProjectVersion, "title" | "validationMarkdown" | "research" | "plan">;
  next: Pick<ProjectVersion, "title" | "validationMarkdown" | "research" | "plan">;
  /**
   * Skip coalescing and always append.
   *
   * Set by restore. Coalescing keeps the *older* of two nearby snapshots, so a
   * restore inside the window would fold into the entry it is restoring from
   * and throw away the state being replaced — leaving the user unable to undo
   * the restore. Coalescing exists to compress autosave noise, and a restore is
   * not noise.
   */
  force?: boolean;
}): Promise<boolean> {
  const changed = diffArtifacts(input.previous, input.next);
  if (changed.length === 0) return false;

  // Never snapshot an empty starting point. The first save of a project has
  // nothing before it, and a blank "version 1" is noise in every timeline.
  const hasContent =
    !!input.previous.validationMarkdown || !!input.previous.research || !!input.previous.plan;
  if (!hasContent) return false;

  const c = await versions();
  const latest = await c.find({ projectId: input.projectId }).sort({ createdAt: -1 }).limit(1).next();

  const doc: VersionDoc = {
    _id: randomUUID(),
    projectId: input.projectId,
    userId: input.userId,
    ...input.previous,
    changed,
    createdAt: Date.now(),
  };

  // Coalesce a rapid series of edits into the *oldest* of them, so the entry
  // that survives is the state before the session started rather than a
  // half-finished intermediate.
  if (!input.force && latest && Date.now() - latest.createdAt < COALESCE_MS) {
    await c.updateOne(
      { _id: latest._id },
      { $set: { changed: [...new Set([...latest.changed, ...changed])] } },
    );
    return false;
  }

  await c.insertOne(doc);
  await prune(input.projectId);
  return true;
}

/** Keep the newest MAX_VERSIONS and drop the rest. */
async function prune(projectId: string): Promise<void> {
  const c = await versions();
  const stale = await c
    .find({ projectId }, { projection: { _id: 1 } })
    .sort({ createdAt: -1 })
    .skip(MAX_VERSIONS)
    .toArray();
  if (stale.length) {
    await c.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
  }
}

/** Timeline for a project, newest first. Summary fields only. */
export async function listVersions(projectId: string): Promise<VersionSummary[]> {
  const rows = await (await versions())
    .find(
      { projectId },
      {
        projection: {
          title: 1,
          changed: 1,
          createdAt: 1,
          validationMarkdown: 1,
          research: 1,
          plan: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .toArray();

  return rows.map((d) => ({
    id: d._id,
    title: d.title,
    changed: d.changed ?? [],
    hasValidation: !!d.validationMarkdown,
    hasResearch: d.research != null,
    hasPlan: d.plan != null,
    createdAt: d.createdAt,
  }));
}

/**
 * Fetch one version, scoped to the project it belongs to.
 *
 * `projectId` is part of the filter rather than trusted from the caller's
 * lookup: a version id alone must never be enough to read a snapshot of
 * someone else's project.
 */
export async function getVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectVersion | null> {
  const d = await (await versions()).findOne({ _id: versionId, projectId });
  return d ? toVersion(d) : null;
}

export async function countVersions(projectId: string): Promise<number> {
  return (await versions()).countDocuments({ projectId });
}

/** Drop a project's history — called when the project itself is deleted. */
export async function purgeVersions(projectId: string): Promise<void> {
  await (await versions()).deleteMany({ projectId });
}
