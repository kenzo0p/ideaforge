import { randomUUID } from "node:crypto";
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
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  title: string;
  idea: string;
  locale: string | null;
  validation_md: string | null;
  research_json: string | null;
  plan_json: string | null;
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SaveProjectInput {
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
       (id, title, idea, locale, validation_md, research_json, plan_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.idea,
    input.locale ?? null,
    input.validationMarkdown ?? null,
    input.research ? JSON.stringify(input.research) : null,
    input.plan ? JSON.stringify(input.plan) : null,
    now,
    now,
  );
  return getProject(id)!;
}

/** Overwrite a project's artifacts (used when re-saving an in-progress session). */
export function updateProjectArtifacts(id: string, input: SaveProjectInput): void {
  getDb()
    .prepare(
      `UPDATE projects
         SET title = ?, validation_md = ?, research_json = ?, plan_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.title,
      input.validationMarkdown ?? null,
      input.research ? JSON.stringify(input.research) : null,
      input.plan ? JSON.stringify(input.plan) : null,
      Date.now(),
      id,
    );
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(): ProjectSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all() as ProjectRow[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    idea: r.idea,
    hasValidation: !!r.validation_md,
    hasResearch: !!r.research_json,
    hasPlan: !!r.plan_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function updateProjectTitle(id: string, title: string): void {
  getDb()
    .prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, Date.now(), id);
}

export function deleteProject(id: string): void {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
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

export function deleteWorkspaceItem(id: string): void {
  getDb().prepare("DELETE FROM workspace_items WHERE id = ?").run(id);
}
