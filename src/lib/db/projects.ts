import { randomBytes, randomUUID } from "node:crypto";
import { many, one, run } from "./index";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Project + Research Workspace repository
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
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  user_id: string | null;
  title: string;
  idea: string;
  locale: string | null;
  validation_md: string | null;
  research_json: string | null;
  plan_json: string | null;
  share_token: string | null;
  created_at: number;
  updated_at: number;
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    title: r.title,
    idea: r.idea,
    locale: r.locale,
    validationMarkdown: r.validation_md,
    research: parse<ResearchReport>(r.research_json),
    plan: parse<ProjectPlan>(r.plan_json),
    shareToken: r.share_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
  const id = randomUUID();
  await run(
    `INSERT INTO projects
       (id, user_id, title, idea, locale, validation_md, research_json, plan_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.title,
      input.idea,
      input.locale ?? null,
      input.validationMarkdown ?? null,
      input.research ? JSON.stringify(input.research) : null,
      input.plan ? JSON.stringify(input.plan) : null,
      now,
      now,
    ],
  );
  return (await getProject(id, input.userId))!;
}

/**
 * Overwrite a project's artifacts (re-saving an in-progress session). Scoped to
 * the owner: a mismatched user_id updates nothing.
 */
export async function updateProjectArtifacts(
  id: string,
  userId: string,
  input: SaveProjectInput,
): Promise<void> {
  await run(
    `UPDATE projects
       SET title = ?, validation_md = ?, research_json = ?, plan_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      input.title,
      input.validationMarkdown ?? null,
      input.research ? JSON.stringify(input.research) : null,
      input.plan ? JSON.stringify(input.plan) : null,
      Date.now(),
      id,
      userId,
    ],
  );
}

/** Fetch a project only if it belongs to `userId` (authorization boundary). */
export async function getProject(id: string, userId: string): Promise<Project | null> {
  const row = await one<ProjectRow>("SELECT * FROM projects WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return row ? rowToProject(row) : null;
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await many<ProjectRow>(
    "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    idea: r.idea,
    hasValidation: !!r.validation_md,
    hasResearch: !!r.research_json,
    hasPlan: !!r.plan_json,
    totalMilestones: parse<ProjectPlan>(r.plan_json)?.milestones?.length ?? 0,
    shared: !!r.share_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function updateProjectTitle(
  id: string,
  userId: string,
  title: string,
): Promise<void> {
  await run("UPDATE projects SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
    title,
    Date.now(),
    id,
    userId,
  ]);
}

export async function deleteProject(id: string, userId: string): Promise<void> {
  await run("DELETE FROM projects WHERE id = ? AND user_id = ?", [id, userId]);
}

// --- Public sharing --------------------------------------------------------

/** Enable sharing and return the token (idempotent — reuses an existing one). */
export async function enableShare(id: string, userId: string): Promise<string | null> {
  const project = await getProject(id, userId);
  if (!project) return null;
  if (project.shareToken) return project.shareToken;

  const token = randomBytes(12).toString("hex");
  await run("UPDATE projects SET share_token = ? WHERE id = ? AND user_id = ?", [
    token,
    id,
    userId,
  ]);
  return token;
}

export async function disableShare(id: string, userId: string): Promise<void> {
  await run("UPDATE projects SET share_token = NULL WHERE id = ? AND user_id = ?", [id, userId]);
}

/** Look up a shared project by its public token (no auth — read-only view). */
export async function getProjectByShareToken(token: string): Promise<Project | null> {
  const row = await one<ProjectRow>("SELECT * FROM projects WHERE share_token = ?", [token]);
  return row ? rowToProject(row) : null;
}

// --- Milestone progress ----------------------------------------------------

/** Indices of completed milestones for a project. */
export async function getMilestoneProgress(projectId: string): Promise<number[]> {
  const rows = await many<{ idx: number }>(
    "SELECT idx FROM milestone_progress WHERE project_id = ? AND done = 1",
    [projectId],
  );
  return rows.map((r) => Number(r.idx));
}

export async function setMilestoneDone(
  projectId: string,
  idx: number,
  done: boolean,
): Promise<void> {
  await run(
    `INSERT INTO milestone_progress (project_id, idx, done, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, idx) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
    [projectId, idx, done ? 1 : 0, Date.now()],
  );
}

/** Completed-milestone counts keyed by project id (for dashboard rings). */
export async function milestoneCounts(userId: string): Promise<Record<string, number>> {
  const rows = await many<{ pid: string; c: number }>(
    `SELECT m.project_id AS pid, COUNT(*) AS c
       FROM milestone_progress m
       JOIN projects p ON p.id = m.project_id
      WHERE p.user_id = ? AND m.done = 1
      GROUP BY m.project_id`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.pid, Number(r.c)]));
}

// --- Research Workspace ----------------------------------------------------

export async function addWorkspaceItem(input: {
  projectId: string;
  kind: WorkspaceKind;
  title: string;
  url?: string | null;
  body?: string | null;
}): Promise<WorkspaceItem> {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO workspace_items (id, project_id, kind, title, url, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.projectId, input.kind, input.title, input.url ?? null, input.body ?? null, now],
  );
  // Touch the parent project so it sorts to the top of the dashboard.
  await run("UPDATE projects SET updated_at = ? WHERE id = ?", [now, input.projectId]);
  return {
    id,
    projectId: input.projectId,
    kind: input.kind,
    title: input.title,
    url: input.url ?? null,
    body: input.body ?? null,
    createdAt: now,
  };
}

export async function listWorkspaceItems(projectId: string): Promise<WorkspaceItem[]> {
  const rows = await many<{
    id: string;
    project_id: string;
    kind: WorkspaceKind;
    title: string;
    url: string | null;
    body: string | null;
    created_at: number;
  }>("SELECT * FROM workspace_items WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    body: r.body,
    createdAt: r.created_at,
  }));
}

/** Delete a workspace item only if its project belongs to `userId`. */
export async function deleteWorkspaceItem(id: string, userId: string): Promise<void> {
  await run(
    `DELETE FROM workspace_items
      WHERE id = ?
        AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`,
    [id, userId],
  );
}
