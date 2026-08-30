"use server";

import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject } from "@/lib/db/projects";
import { canCreateWatch, canUseCadence } from "@/lib/billing/entitlements";
import { deepResearchQueries } from "@/lib/pipeline/prompts";
import {
  countActiveWatches,
  createWatch,
  getWatch,
  listFindings,
  markFindingsSeen,
  setWatchCadence,
  stopWatch,
  type WatchCadence,
} from "@/lib/db/watches";

export interface WatchState {
  error?: string;
  upgradeTo?: "pro" | "team";
  ok?: boolean;
}

/** Watch state plus findings for the project page. */
export async function watchStatusAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await getProject(projectId, user.id))) return null;

  return {
    watch: await getWatch(projectId, user.id),
    findings: await listFindings(projectId, user.id),
  };
}

export async function startWatchAction(
  projectId: string,
  cadence: WatchCadence = "weekly",
): Promise<WatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const cadenceGate = await canUseCadence(user.id, cadence);
  if (!cadenceGate.allowed) return { error: cadenceGate.reason, upgradeTo: cadenceGate.upgradeTo };

  // Re-enabling an existing watch shouldn't count against the quota.
  const existing = await getWatch(projectId, user.id);
  if (!existing) {
    const gate = await canCreateWatch(user.id, await countActiveWatches(user.id));
    if (!gate.allowed) return { error: gate.reason, upgradeTo: gate.upgradeTo };
  }

  // Prefer the queries DeepSearch actually ran — they were derived with the
  // full idea in hand. Fall back to deriving them when there's no research yet.
  const queries = project.research?.queries?.length
    ? project.research.queries
    : deepResearchQueries(project.idea);

  await createWatch({
    projectId,
    projectTitle: project.title,
    userId: user.id,
    cadence,
    queries,
  });
  void track(EVENTS.WATCH_STARTED, { userId: user.id, props: { cadence } });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function stopWatchAction(projectId: string): Promise<WatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  void track(EVENTS.WATCH_STOPPED, { userId: user.id });
  await stopWatch(projectId, user.id);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function setWatchCadenceAction(
  projectId: string,
  cadence: WatchCadence,
): Promise<WatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const gate = await canUseCadence(user.id, cadence);
  if (!gate.allowed) return { error: gate.reason, upgradeTo: gate.upgradeTo };

  await setWatchCadence(projectId, user.id, cadence);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function markFindingsSeenAction(projectId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await markFindingsSeen(projectId, user.id);
  revalidatePath(`/projects/${projectId}`);
}
