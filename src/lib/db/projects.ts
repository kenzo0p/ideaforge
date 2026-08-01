import { randomBytes, randomUUID } from "node:crypto";
import { col } from "./index";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Project + Research Workspace repository
//
// A project is one document. Milestone progress and workspace items live inside
// it as arrays: they are only ever read with their project, they are small, and
// embedding makes deleting a project a single atomic operation with no orphans.
//
// `research` and `plan` are stored as real subdocuments. They used to be JSON
// strings in TEXT columns, which is the clearest sign this data wanted a
// document store in the first place.
// ---------------------------------------------------------------------------

export type WorkspaceKind = "source" | "note" | "decision";

export interface WorkspaceItem {
  id: string;
  projectId: string;
  kind: WorkspaceKind;
  title: string;
  url: string | null;
  body: string | null;
  createdAt: number;
}

export interface Project {
  id: string;
  title: string;
  idea: string;
  locale: string | null;
  validationMarkdown: string | null;
  research: ResearchReport | null;
  plan: ProjectPlan | null;
  /** Public read-only share token, or null when not shared. */
  shareToken: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A project without the heavy artifact bodies — for dashboard listing. */
export interface ProjectSummary {
  id: string;
  title: string;
  idea: string;
  hasValidation: boolean;
  hasResearch: boolean;
  hasPlan: boolean;
  /** Total milestones in the saved plan (0 when there's no plan yet). */
  totalMilestones: number;
  shared: boolean;
  /** False when this project was shared with you by someone else. */
  isOwner: boolean;
  /** Number of collaborators, excluding the owner. */
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Embedded milestone completion state. */
interface MilestoneDoc {
  idx: number;
  done: boolean;
  updatedAt: number;
}

/** Embedded workspace item (`id` is ours; `_id` belongs to the project). */
interface WorkspaceItemDoc {
  id: string;
  kind: WorkspaceKind;
  title: string;
  url: string | null;
  body: string | null;
  createdAt: number;
}

/** Someone invited onto the project. The owner is `ProjectDoc.userId`, not a member. */
export interface ProjectMember {
  userId: string;
  email: string;
  /** Handle they're shown and invited by. */
  username: string;
  name: string | null;
  joinedAt: number;
}

interface ProjectDoc {
  _id: string;
  /** The owner. Only the owner can rename, delete, share, or manage members. */
  userId: string;
  /** Collaborators. Absent on projects created before collaboration existed. */
  members?: ProjectMember[];
  title: string;
  idea: string;
  locale: string | null;
  validationMarkdown: string | null;
  research: ResearchReport | null;
  plan: ProjectPlan | null;
  shareToken?: string;
  milestones: MilestoneDoc[];
  workspaceItems: WorkspaceItemDoc[];
  createdAt: number;
  updatedAt: number;
}

const projects = () => col<ProjectDoc>("projects");

/**
 * The single access rule: you can reach a project if you own it or you were
 * invited onto it.
 *
 * Every read goes through this filter rather than matching `userId` directly.
 * Spreading the rule across call sites is how a collaborator ends up locked out
 * of one screen, or — far worse — how a stranger keeps access to another.
 */
function accessFilter(userId: string) {
  return { $or: [{ userId }, { "members.userId": userId }] };
}

function toProject(d: ProjectDoc): Project {
  return {
    id: d._id,
    title: d.title,
    idea: d.idea,
    locale: d.locale ?? null,
    validationMarkdown: d.validationMarkdown ?? null,
    research: d.research ?? null,
    plan: d.plan ?? null,
    shareToken: d.shareToken ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export interface SaveProjectInput {
  userId: string;
  title: string;
  idea: string;
  locale?: string;
  validationMarkdown?: string | null;
  research?: ResearchReport | null;
  plan?: ProjectPlan | null;
}

export async function createProject(input: SaveProjectInput): Promise<Project> {
  const now = Date.now();
  const doc: ProjectDoc = {
    _id: randomUUID(),
    userId: input.userId,
    title: input.title,
    idea: input.idea,
    locale: input.locale ?? null,
    validationMarkdown: input.validationMarkdown ?? null,
    research: input.research ?? null,
    plan: input.plan ?? null,
    milestones: [],
    workspaceItems: [],
    createdAt: now,
    updatedAt: now,
  };
  await (await projects()).insertOne(doc);
  return toProject(doc);
}

/**
 * Overwrite a project's artifacts (re-saving an in-progress session). Scoped to
 * the owner: a mismatched userId updates nothing.
 */
export async function updateProjectArtifacts(
  id: string,
  userId: string,
  input: SaveProjectInput,
): Promise<void> {
  await (await projects()).updateOne(
    { _id: id, userId },
    {
      $set: {
        title: input.title,
        validationMarkdown: input.validationMarkdown ?? null,
        research: input.research ?? null,
        plan: input.plan ?? null,
        updatedAt: Date.now(),
      },
    },
  );
}

/** Fetch a project if `userId` owns it or was invited onto it. */
export async function getProject(id: string, userId: string): Promise<Project | null> {
  const d = await (await projects()).findOne({ _id: id, ...accessFilter(userId) });
  return d ? toProject(d) : null;
}

/** True only for the owner. Guards renaming, deleting, sharing, and invites. */
export async function isProjectOwner(id: string, userId: string): Promise<boolean> {
  return (await (await projects()).countDocuments({ _id: id, userId }, { limit: 1 })) > 0;
}

/** Everyone who can see the project: the owner first, then collaborators. */
export async function listMembers(
  id: string,
  userId: string,
): Promise<{ ownerId: string; members: ProjectMember[] } | null> {
  const d = await (await projects()).findOne(
    { _id: id, ...accessFilter(userId) },
    { projection: { userId: 1, members: 1 } },
  );
  if (!d) return null;
  return { ownerId: d.userId, members: d.members ?? [] };
}

/** Add a collaborator. Idempotent — re-accepting an invite is not an error. */
export async function addMember(id: string, member: ProjectMember): Promise<void> {
  const c = await projects();
  // Never let the owner also appear as a member; it would show them twice and
  // let "leave project" strand a project with no owner.
  const already = await c.countDocuments(
    { _id: id, $or: [{ userId: member.userId }, { "members.userId": member.userId }] },
    { limit: 1 },
  );
  if (already) return;
  await c.updateOne({ _id: id }, { $push: { members: member }, $set: { updatedAt: Date.now() } });
}

/**
 * Remove a collaborator. The owner can remove anyone; a collaborator may only
 * remove themselves (leaving), which is why `actorId` is checked here rather
 * than trusted from the caller.
 */
export async function removeMember(
  id: string,
  actorId: string,
  targetUserId: string,
): Promise<boolean> {
  const owner = await isProjectOwner(id, actorId);
  if (!owner && actorId !== targetUserId) return false;
  const res = await (await projects()).updateOne(
    { _id: id, ...accessFilter(actorId) },
    { $pull: { members: { userId: targetUserId } } },
  );
  return res.modifiedCount > 0;
}

/**
 * Dashboard listing. Uses an aggregation so the heavy `research` and `plan`
 * bodies never leave the server — only the booleans and counts the cards need.
 */
export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await (await projects())
    .aggregate<{
      _id: string;
      title: string;
      idea: string;
      hasValidation: boolean;
      hasResearch: boolean;
      hasPlan: boolean;
      totalMilestones: number;
      shared: boolean;
      isOwner: boolean;
      memberCount: number;
      createdAt: number;
      updatedAt: number;
    }>([
      { $match: accessFilter(userId) },
      { $sort: { updatedAt: -1 } },
      {
        $project: {
          title: 1,
          idea: 1,
          createdAt: 1,
          updatedAt: 1,
          hasValidation: { $gt: [{ $strLenCP: { $ifNull: ["$validationMarkdown", ""] } }, 0] },
          hasResearch: { $ne: [{ $ifNull: ["$research", null] }, null] },
          hasPlan: { $ne: [{ $ifNull: ["$plan", null] }, null] },
          totalMilestones: { $size: { $ifNull: ["$plan.milestones", []] } },
          shared: { $ne: [{ $ifNull: ["$shareToken", null] }, null] },
          isOwner: { $eq: ["$userId", userId] },
          memberCount: { $size: { $ifNull: ["$members", []] } },
        },
      },
    ])
    .toArray();

  return rows.map((r) => ({
    id: r._id,
    title: r.title,
    idea: r.idea,
    hasValidation: r.hasValidation,
    hasResearch: r.hasResearch,
    hasPlan: r.hasPlan,
    totalMilestones: r.totalMilestones,
    shared: r.shared,
    isOwner: r.isOwner,
    memberCount: r.memberCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function updateProjectTitle(
  id: string,
  userId: string,
  title: string,
): Promise<void> {
  await (await projects()).updateOne(
    { _id: id, userId },
    { $set: { title, updatedAt: Date.now() } },
  );
}

export async function deleteProject(id: string, userId: string): Promise<void> {
  await (await projects()).deleteOne({ _id: id, userId });
  // Reminders live in their own collection because the scheduler queries them
  // across all projects, so they need clearing explicitly.
  await Promise.all([
    (await col("reminders")).deleteMany({ projectId: id, userId }),
    (await col("reminderLogs")).deleteMany({ projectId: id, userId }),
    (await col("projectInvites")).deleteMany({ projectId: id }),
    (await col("projectComments")).deleteMany({ projectId: id }),
  ]);
}

// --- Public sharing --------------------------------------------------------

/** Enable sharing and return the token (idempotent — reuses an existing one). */
export async function enableShare(id: string, userId: string): Promise<string | null> {
  const project = await getProject(id, userId);
  if (!project) return null;
  if (project.shareToken) return project.shareToken;

  const token = randomBytes(12).toString("hex");
  await (await projects()).updateOne({ _id: id, userId }, { $set: { shareToken: token } });
  return token;
}

export async function disableShare(id: string, userId: string): Promise<void> {
  // $unset rather than null: the unique index on shareToken is sparse, and a
  // stored null would collide with every other unshared project.
  await (await projects()).updateOne({ _id: id, userId }, { $unset: { shareToken: "" } });
}

/** Look up a shared project by its public token (no auth — read-only view). */
export async function getProjectByShareToken(token: string): Promise<Project | null> {
  const d = await (await projects()).findOne({ shareToken: token });
  return d ? toProject(d) : null;
}

// --- Milestone progress ----------------------------------------------------

/** Indices of completed milestones for a project. */
export async function getMilestoneProgress(projectId: string): Promise<number[]> {
  const d = await (await projects()).findOne(
    { _id: projectId },
    { projection: { milestones: 1 } },
  );
  return (d?.milestones ?? []).filter((m) => m.done).map((m) => m.idx);
}

export async function setMilestoneDone(
  projectId: string,
  idx: number,
  done: boolean,
): Promise<void> {
  const c = await projects();
  const now = Date.now();
  // Update in place when the milestone is already tracked…
  const res = await c.updateOne(
    { _id: projectId, "milestones.idx": idx },
    { $set: { "milestones.$.done": done, "milestones.$.updatedAt": now } },
  );
  // …otherwise append it. (The SQLite version was an upsert on (project, idx).)
  if (res.matchedCount === 0) {
    await c.updateOne(
      { _id: projectId },
      { $push: { milestones: { idx, done, updatedAt: now } } },
    );
  }
}

/** Completed-milestone counts keyed by project id (for dashboard rings). */
export async function milestoneCounts(userId: string): Promise<Record<string, number>> {
  const rows = await (await projects())
    .aggregate<{ _id: string; c: number }>([
      { $match: accessFilter(userId) },
      {
        $project: {
          c: {
            $size: {
              $filter: {
                input: { $ifNull: ["$milestones", []] },
                cond: { $eq: ["$$this.done", true] },
              },
            },
          },
        },
      },
      { $match: { c: { $gt: 0 } } },
    ])
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.c]));
}

// --- Research Workspace ----------------------------------------------------

export async function addWorkspaceItem(input: {
  projectId: string;
  kind: WorkspaceKind;
  title: string;
  url?: string | null;
  body?: string | null;
}): Promise<WorkspaceItem> {
  const item: WorkspaceItemDoc = {
    id: randomUUID(),
    kind: input.kind,
    title: input.title,
    url: input.url ?? null,
    body: input.body ?? null,
    createdAt: Date.now(),
  };
  // Appending also touches the project so it sorts to the top of the dashboard.
  await (await projects()).updateOne(
    { _id: input.projectId },
    { $push: { workspaceItems: item }, $set: { updatedAt: item.createdAt } },
  );
  return { ...item, projectId: input.projectId };
}

export async function listWorkspaceItems(projectId: string): Promise<WorkspaceItem[]> {
  const d = await (await projects()).findOne(
    { _id: projectId },
    { projection: { workspaceItems: 1 } },
  );
  // Newest first. Two items added in the same millisecond tie on createdAt, so
  // fall back to insertion order reversed — otherwise a stable sort leaves them
  // oldest-first, which is exactly backwards.
  return (d?.workspaceItems ?? [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.createdAt - a.item.createdAt || b.index - a.index)
    .map(({ item }) => ({ ...item, projectId }));
}

/** Delete a workspace item only if its project belongs to `userId`. */
export async function deleteWorkspaceItem(id: string, userId: string): Promise<void> {
  await (await projects()).updateOne(
    { ...accessFilter(userId), "workspaceItems.id": id },
    { $pull: { workspaceItems: { id } } },
  );
}
