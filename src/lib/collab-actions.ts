"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { sendProjectInviteEmail } from "@/lib/email/verification";
import {
  addComment,
  createInvite,
  listComments,
  listInvites,
  revokeInvite,
  deleteComment,
  type CommentAnchor,
} from "@/lib/db/collaboration";
import { getProject, isProjectOwner, listMembers, removeMember } from "@/lib/db/projects";

// ---------------------------------------------------------------------------
// Collaboration server actions.
//
// Two different permissions apply here and they are checked separately:
//   • inviting and removing people is the OWNER's alone
//   • commenting is open to anyone with access to the project
// Neither trusts an id from the client — the actor always comes from the session.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CollabState {
  error?: string;
  /** Surfaced when the invite couldn't be emailed, so it can still be copied. */
  inviteLink?: string;
  ok?: boolean;
}

async function requireOwner(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." as const };
  if (!(await isProjectOwner(projectId, user.id))) {
    // Same message whether the project is missing or simply not theirs — no
    // reason to confirm that someone else's project id exists.
    return { error: "Only the project owner can do that." as const };
  }
  return { user };
}

export async function inviteCollaboratorAction(
  projectId: string,
  email: string,
): Promise<CollabState> {
  const gate = await requireOwner(projectId);
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { error: "Enter a valid email address." };
  if (clean === user.email.toLowerCase()) return { error: "That's you — you already own this." };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const roster = await listMembers(projectId, user.id);
  if (roster?.members.some((m) => m.email === clean)) {
    return { error: "They're already on this project." };
  }

  const invite = await createInvite({
    projectId,
    email: clean,
    invitedByUserId: user.id,
    invitedByName: user.name ?? user.email,
  });

  const { link, delivered } = await sendProjectInviteEmail(
    clean,
    invite.token,
    project.title,
    user.name ?? user.email,
  );

  revalidatePath(`/projects/${projectId}`);
  // When delivery fails the invite is still valid — hand back the link so the
  // owner can pass it on themselves rather than hitting a dead end.
  return delivered ? { ok: true } : { ok: true, inviteLink: link };
}

export async function revokeInviteAction(projectId: string, email: string): Promise<CollabState> {
  const gate = await requireOwner(projectId);
  if ("error" in gate) return { error: gate.error };
  await revokeInvite(projectId, email);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/** Owner removes a collaborator, or a collaborator leaves. Enforced in the repo. */
export async function removeMemberAction(
  projectId: string,
  targetUserId: string,
): Promise<CollabState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  const done = await removeMember(projectId, user.id, targetUserId);
  if (!done) return { error: "Couldn't remove that person." };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function addCommentAction(
  projectId: string,
  anchor: CommentAnchor,
  body: string,
): Promise<CollabState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  // Access, not ownership: collaborators are the whole point of comments.
  if (!(await getProject(projectId, user.id))) return { error: "Project not found." };

  const text = body.trim();
  if (!text) return { error: "Write something first." };
  if (text.length > 2000) return { error: "Comment is too long (max 2000 characters)." };

  await addComment({
    projectId,
    userId: user.id,
    authorName: user.name ?? user.email,
    anchor,
    body: text,
  });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteCommentAction(
  projectId: string,
  commentId: string,
): Promise<CollabState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  // Scoped to the author inside the repo, so this can't delete someone else's.
  await deleteComment(commentId, user.id);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/** Roster + pending invites for the Collaborate tab. */
export async function collaborationStateAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const roster = await listMembers(projectId, user.id);
  if (!roster) return null;
  const owner = roster.ownerId === user.id;
  return {
    isOwner: owner,
    members: roster.members,
    invites: owner ? await listInvites(projectId) : [],
    comments: await listComments(projectId),
    me: user.id,
  };
}
