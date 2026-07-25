"use server";

import { revalidatePath } from "next/cache";
import {
  addWorkspaceItem,
  createProject,
  deleteProject,
  deleteWorkspaceItem,
  updateProjectArtifacts,
  updateProjectTitle,
  type SaveProjectInput,
  type WorkspaceKind,
} from "@/lib/db/projects";

// Server Actions — the only way client components mutate persisted data.

/** Create a project, or update it in place when `id` is supplied (re-save). */
export async function saveProjectAction(
  input: SaveProjectInput & { id?: string },
): Promise<{ id: string }> {
  const title = input.title?.trim() || input.idea.slice(0, 60);
  if (input.id) {
    updateProjectArtifacts(input.id, { ...input, title });
    revalidatePath("/dashboard");
    revalidatePath(`/projects/${input.id}`);
    return { id: input.id };
  }
  const project = createProject({ ...input, title });
  revalidatePath("/dashboard");
  return { id: project.id };
}

export async function renameProjectAction(id: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return;
  updateProjectTitle(id, clean);
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${id}`);
}

export async function deleteProjectAction(id: string): Promise<void> {
  deleteProject(id);
  revalidatePath("/dashboard");
}

export async function addWorkspaceItemAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const kind = String(formData.get("kind") ?? "note") as WorkspaceKind;
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim() || null;
  if (!projectId || !title) return;

  addWorkspaceItem({ projectId, kind, title, url, body });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteWorkspaceItemAction(id: string, projectId: string): Promise<void> {
  deleteWorkspaceItem(id);
  revalidatePath(`/projects/${projectId}`);
}
