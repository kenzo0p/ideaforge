"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject } from "@/lib/db/projects";
import {
  disconnect,
  getCredentials,
  listConnections,
  refreshAccessToken,
  type Provider,
} from "@/lib/db/integrations";
import { buildMarkdownBrief } from "@/lib/export/brief";
import { buildDocxBuffer } from "@/lib/export/doc";
import { createNotionPage, isNotionConfigured } from "@/lib/integrations/notion";
import {
  createGoogleDoc,
  isGoogleDocsConfigured,
  refreshGoogleToken,
} from "@/lib/integrations/google";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { canUseFeature } from "@/lib/billing/entitlements";

export interface ExportResult {
  url?: string;
  error?: string;
  /** Set when the user needs to connect the provider first. */
  needsConnect?: Provider;
  /** Set when the refusal is the plan, so the UI can offer the upgrade. */
  upgradeTo?: "pro" | "team";
}

/** What the UI needs to render connect/disconnect state. */
export async function integrationStatusAction() {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    connections: await listConnections(user.id),
    available: {
      notion: isNotionConfigured() && isEncryptionConfigured(),
      google: isGoogleDocsConfigured() && isEncryptionConfigured(),
    },
  };
}

export async function disconnectIntegrationAction(provider: Provider): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await disconnect(user.id, provider);
  revalidatePath("/settings");
}

/**
 * A usable Google access token, refreshing when it's close to expiring.
 *
 * Google access tokens last an hour; a project exported the day after
 * connecting would otherwise always fail. Refreshed 60s early so a token can't
 * expire mid-upload.
 */
async function freshGoogleToken(userId: string): Promise<string | null> {
  const creds = await getCredentials(userId, "google");
  if (!creds) return null;

  if (creds.expiresAt && creds.expiresAt - 60_000 > Date.now()) return creds.accessToken;
  if (!creds.refreshToken) return null; // Nothing to refresh with — reconnect.

  try {
    const next = await refreshGoogleToken(creds.refreshToken);
    await refreshAccessToken(userId, "google", next.accessToken, next.expiresAt);
    return next.accessToken;
  } catch (err) {
    console.error("Google token refresh failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function exportToNotionAction(projectId: string): Promise<ExportResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const entitled = await canUseFeature(user.id, "integrations");
  if (!entitled.allowed) return { error: entitled.reason, upgradeTo: entitled.upgradeTo };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const creds = await getCredentials(user.id, "notion");
  if (!creds) return { needsConnect: "notion" };

  try {
    const markdown = buildMarkdownBrief({
      title: project.title,
      idea: project.idea,
      createdAt: project.createdAt,
      validationMarkdown: project.validationMarkdown,
      research: project.research,
      plan: project.plan,
    });
    const { url } = await createNotionPage({
      accessToken: creds.accessToken,
      title: project.title,
      markdown,
    });
    return { url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't export to Notion." };
  }
}

export async function exportToGoogleDocsAction(projectId: string): Promise<ExportResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const entitled = await canUseFeature(user.id, "integrations");
  if (!entitled.allowed) return { error: entitled.reason, upgradeTo: entitled.upgradeTo };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const accessToken = await freshGoogleToken(user.id);
  if (!accessToken) return { needsConnect: "google" };

  try {
    // Same .docx the download button produces — Drive converts it on upload.
    const docx = await buildDocxBuffer({
      title: project.title,
      idea: project.idea,
      createdAt: project.createdAt,
      validationMarkdown: project.validationMarkdown,
      research: project.research,
      plan: project.plan,
    });
    const { url } = await createGoogleDoc({ accessToken, title: project.title, docx });
    return { url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't export to Google Docs." };
  }
}
