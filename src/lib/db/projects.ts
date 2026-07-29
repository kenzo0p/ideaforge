import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./index";
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

export function createProject(input: SaveProjectInput): Project {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects
       (id, user_id, title, idea, locale, validation_md, research_json, plan_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
  );
  return getProject(id, input.userId)!;
}

/**
 * Overwrite a project's artifacts (re-saving an in-progress session). Scoped to
 * the owner: a mismatched user_id updates nothing.
 */
export function updateProjectArtifacts(id: string, userId: string, input: SaveProjectInput): void {
  getDb()
    .prepare(
      `UPDATE projects
         SET title = ?, validation_md = ?, research_json = ?, plan_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.title,
      input.validationMarkdown ?? null,
      input.research ? JSON.stringify(input.research) : null,
      input.plan ? JSON.stringify(input.plan) : null,
      Date.now(),
      id,
      userId,
    );
}

/** Fetch a project only if it belongs to `userId` (authorization boundary). */
export function getProject(id: string, userId: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(id, userId) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(userId: string): ProjectSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as ProjectRow[];
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

export function updateProjectTitle(id: string, userId: string, title: string): void {
  getDb()
    .prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title, Date.now(), id, userId);
}

export function deleteProject(id: string, userId: string): void {
  getDb().prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
}

// --- Public sharing --------------------------------------------------------

/** Enable sharing and return the token (idempotent — reuses an existing one). */
export function enableShare(id: string, userId: string): string | null {
  const project = getProject(id, userId);
  if (!project) return null;
  if (project.shareToken) return project.shareToken;

  const token = randomBytes(12).toString("hex");
  getDb()
    .prepare("UPDATE projects SET share_token = ? WHERE id = ? AND user_id = ?")
    .run(token, id, userId);
  return token;
}

export function disableShare(id: string, userId: string): void {
  getDb()
    .prepare("UPDATE projects SET share_token = NULL WHERE id = ? AND user_id = ?")
    .run(id, userId);
}

/** Look up a shared project by its public token (no auth — read-only view). */
export function getProjectByShareToken(token: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE share_token = ?")
    .get(token) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

// --- Milestone progress ----------------------------------------------------

/** Indices of completed milestones for a project. */
export function getMilestoneProgress(projectId: string): number[] {
  const rows = getDb()
    .prepare("SELECT idx FROM milestone_progress WHERE project_id = ? AND done = 1")
    .all(projectId) as Array<{ idx: number }>;
  return rows.map((r) => r.idx);
}

export function setMilestoneDone(projectId: string, idx: number, done: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO milestone_progress (project_id, idx, done, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, idx) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
    )
    .run(projectId, idx, done ? 1 : 0, Date.now());
}

/** Completed-milestone counts keyed by project id (for dashboard rings). */
export function milestoneCounts(userId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT m.project_id AS pid, COUNT(*) AS c
         FROM milestone_progress m
         JOIN projects p ON p.id = m.project_id
        WHERE p.user_id = ? AND m.done = 1
        GROUP BY m.project_id`,
    )
    .all(userId) as Array<{ pid: string; c: number }>;
  return Object.fromEntries(rows.map((r) => [r.pid, r.c]));
}

// --- Research Workspace ----------------------------------------------------

export function addWorkspaceItem(input: {
  projectId: string;
  kind: WorkspaceKind;
  title: string;
  url?: string | null;
  body?: string | null;
}): WorkspaceItem {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO workspace_items (id, project_id, kind, title, url, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.kind, input.title, input.url ?? null, input.body ?? null, now);
  // Touch the parent project so it sorts to the top of the dashboard.
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, input.projectId);
  return { id, projectId: input.projectId, kind: input.kind, title: input.title, url: input.url ?? null, body: input.body ?? null, createdAt: now };
}

export function listWorkspaceItems(projectId: string): WorkspaceItem[] {
  const rows = getDb()
    .prepare("SELECT * FROM workspace_items WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    kind: WorkspaceKind;
    title: string;
    url: string | null;
    body: string | null;
    created_at: number;
  }>;
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
export function deleteWorkspaceItem(id: string, userId: string): void {
  getDb()
    .prepare(
      `DELETE FROM workspace_items
        WHERE id = ?
          AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`,
    )
    .run(id, userId);
}
