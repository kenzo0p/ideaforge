"use server";

import { revalidatePath } from "next/cache";
import { canCreateProject } from "@/lib/billing/entitlements";
import {
  addWorkspaceItem,
  createProject,
  deleteProject,
  deleteWorkspaceItem,
  disableShare,
  enableShare,
  setListed,
  isDemoDerived,
  getProject,
  setMilestoneDone,
  updateProjectArtifacts,
  updateProjectTitle,
  type SaveProjectInput,
  type WorkspaceKind,
} from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { smartTitle } from "@/lib/format";
import {
  createTelegramLinkCode,
  isTelegramLinked,
  unlinkTelegram,
} from "@/lib/db/telegram";
import { getBotUsername } from "@/lib/agents/telegram";
import { createReminder, deleteReminder } from "@/lib/db/reminders";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

// Server Actions — the only way client components mutate persisted data.
// Every action requires an authenticated user and enforces ownership.

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

/** Create a project, or update it in place when `id` is supplied (re-save). */
export async function saveProjectAction(
  input: Omit<SaveProjectInput, "userId"> & { id?: string },
): Promise<{ id: string }> {
  const userId = await requireUserId();
  // Prefer the plan's product name once one exists; otherwise shorten the idea
  // on a word boundary so titles never read like "…that fuses soil-mo".
  const title = input.plan?.title?.trim() || smartTitle(input.title?.trim() || input.idea);
  if (input.id) {
    await updateProjectArtifacts(input.id, userId, { ...input, userId, title });
    revalidatePath("/dashboard");
    revalidatePath(`/projects/${input.id}`);
    return { id: input.id };
  }
  // Only creation is gated — updating an existing project must keep working
  // even if the account later drops below the limit, or a downgrade would
  // silently make saved work read-only.
  const gate = await canCreateProject(userId);
  if (!gate.allowed) throw new Error(gate.reason ?? "Project limit reached.");

  const project = await createProject({ ...input, userId, title });
  void track(EVENTS.PROJECT_SAVED, { userId, props: { hasResearch: !!input.research, hasPlan: !!input.plan } });
  revalidatePath("/dashboard");
  return { id: project.id };
}

export async function renameProjectAction(id: string, title: string): Promise<void> {
  const userId = await requireUserId();
  const clean = title.trim();
  if (!clean) return;
  await updateProjectTitle(id, userId, clean);
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${id}`);
}

export async function deleteProjectAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await deleteProject(id, userId);
  revalidatePath("/dashboard");
}

export async function addWorkspaceItemAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const projectId = String(formData.get("projectId") ?? "");
  const kind = String(formData.get("kind") ?? "note") as WorkspaceKind;
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim() || null;
  if (!projectId || !title) return;
  // Ownership check: only add to a project the user owns.
  if (!await getProject(projectId, userId)) return;

  await addWorkspaceItem({ projectId, kind, title, url, body });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteWorkspaceItemAction(id: string, projectId: string): Promise<void> {
  const userId = await requireUserId();
  await deleteWorkspaceItem(id, userId);
  revalidatePath(`/projects/${projectId}`);
}

// --- Telegram linking ------------------------------------------------------

/** Mint a one-time link code and return a t.me deep link to connect the bot. */
export async function connectTelegramAction(): Promise<{ deepLink: string | null }> {
  const userId = await requireUserId();
  const { code } = await createTelegramLinkCode(userId);
  const username = await getBotUsername();
  return { deepLink: username ? `https://t.me/${username}?start=${code}` : null };
}

export async function unlinkTelegramAction(): Promise<void> {
  const userId = await requireUserId();
  await unlinkTelegram(userId);
  revalidatePath("/dashboard");
}

export async function isTelegramLinkedAction(): Promise<boolean> {
  const userId = await requireUserId();
  return await isTelegramLinked(userId);
}

// --- Public sharing --------------------------------------------------------

export async function enableShareAction(projectId: string): Promise<{ token: string | null }> {
  const userId = await requireUserId();
  const token = await enableShare(projectId, userId);
  revalidatePath(`/projects/${projectId}`);
  return { token };
}

export async function disableShareAction(projectId: string): Promise<void> {
  const userId = await requireUserId();
  await disableShare(projectId, userId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/explore");
}

/**
 * Opt a shared brief into search engines and the public directory.
 *
 * Separate from sharing on purpose — see `setListed`. The refusal case is real:
 * you can't list a project that isn't shared or has no validation yet.
 */
export async function setListedAction(
  projectId: string,
  listed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const done = await setListed(projectId, userId, listed);
  if (!done) {
    // Two different refusals, and telling them apart matters: one is "finish
    // the work", the other is "this work can't be published at all".
    const project = await getProject(projectId, userId);
    const isDemo = project ? isDemoDerived(project) : false;
    return {
      ok: false,
      error: isDemo
        ? "This project was generated in demo mode, so its sources are examples rather than real ones. Re-run it with a live provider before publishing."
        : "Share the project and validate the idea first — there's nothing to publish yet.",
    };
  }
  if (listed) void track(EVENTS.BRIEF_LISTED, { userId });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/explore");
  return { ok: true };
}

// --- Milestone progress ----------------------------------------------------

export async function toggleMilestoneAction(
  projectId: string,
  idx: number,
  done: boolean,
): Promise<void> {
  const userId = await requireUserId();
  // Ownership check before mutating progress.
  if (!await getProject(projectId, userId)) return;
  await setMilestoneDone(projectId, idx, done);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
}

// --- Reminders -------------------------------------------------------------

const CADENCES: Record<string, { label: string; intervalMs: number; firstDelayMs: number }> = {
  test: { label: "In ~1 min (test)", intervalMs: 0, firstDelayMs: 60_000 },
  daily: { label: "Every day", intervalMs: 86_400_000, firstDelayMs: 86_400_000 },
  "3day": { label: "Every 3 days", intervalMs: 259_200_000, firstDelayMs: 259_200_000 },
  weekly: { label: "Every week", intervalMs: 604_800_000, firstDelayMs: 604_800_000 },
};

export async function createReminderAction(projectId: string, cadence: string): Promise<void> {
  const userId = await requireUserId();
  const c = CADENCES[cadence];
  if (!c || !await getProject(projectId, userId)) return;
  await createReminder({
    userId,
    projectId,
    label: c.label,
    intervalMs: c.intervalMs,
    firstDueAt: Date.now() + c.firstDelayMs,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteReminderAction(id: string, projectId: string): Promise<void> {
  const userId = await requireUserId();
  await deleteReminder(id, userId);
  revalidatePath(`/projects/${projectId}`);
}
