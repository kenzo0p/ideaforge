"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import {
  addComment,
  consumeInviteFor,
  createInvite,
  listComments,
  listInvites,
  revokeInvite,
  deleteComment,
  type CommentAnchor,
} from "@/lib/db/collaboration";
import { addMember, getProject, isProjectOwner, listMembers, removeMember } from "@/lib/db/projects";
import { getUserByUsername, searchUsers } from "@/lib/db/users";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { canAddCollaborator, canUseFeature } from "@/lib/billing/entitlements";
import { publish } from "@/lib/realtime";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

// ---------------------------------------------------------------------------
// Collaboration server actions.
//
// Two different permissions apply here and they are checked separately:
//   • inviting and removing people is the OWNER's alone
//   • commenting is open to anyone with access to the project
// Neither trusts an id from the client — the actor always comes from the session.
// ---------------------------------------------------------------------------

export interface CollabState {
  error?: string;
  ok?: boolean;
  /** Set when the refusal is a plan limit, so the UI can offer an upgrade. */
  upgradeTo?: "pro" | "team";
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

/** Handle suggestions for the invite box. */
export async function searchUsernamesAction(query: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const found = await searchUsers(query, user.id, 5);
  return found.map((u) => ({ username: u.username, name: u.name }));
}

export async function inviteCollaboratorAction(
  projectId: string,
  username: string,
): Promise<CollabState> {
  const gate = await requireOwner(projectId);
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const handle = normalizeUsername(username);
  const invalid = validateUsername(handle);
  if (invalid) return { error: invalid };
  if (handle === user.username) return { error: "That's you — you already own this." };

  // Checked before the username lookup: someone on a plan without collaboration
  // shouldn't have to guess a real teammate's handle to find that out. The seat
  // count below still runs for plans that do have the feature.
  const feature = await canUseFeature(user.id, "collaboration");
  if (!feature.allowed) return { error: feature.reason, upgradeTo: feature.upgradeTo };

  const target = await getUserByUsername(handle);
  if (!target) return { error: `No one here goes by @${handle}.` };

  const project = await getProject(projectId, user.id);
  if (!project) return { error: "Project not found." };

  const roster = await listMembers(projectId, user.id);
  if (roster?.members.some((m) => m.userId === target.id)) {
    return { error: "They're already on this project." };
  }

  // Seat check counts pending invitations too, so someone can't exceed the cap
  // by sending five invitations before any is accepted.
  const pending = (await listInvites(projectId)).length;
  const seats = await canAddCollaborator(user.id, (roster?.members.length ?? 0) + pending);
  if (!seats.allowed) return { error: seats.reason, upgradeTo: seats.upgradeTo };

  await createInvite({
    projectId,
    projectTitle: project.title,
    toUserId: target.id,
    toUsername: target.username,
    invitedByUserId: user.id,
    invitedByName: user.name ?? user.username,
    invitedByUsername: user.username,
  });

  // Nudge their open tabs so the invitation shows up without a refresh.
  void track(EVENTS.COLLABORATOR_INVITED, { userId: user.id });
  publish(`user:${target.id}`, { type: "invite" });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function revokeInviteAction(
  projectId: string,
  toUserId: string,
): Promise<CollabState> {
  const gate = await requireOwner(projectId);
  if ("error" in gate) return { error: gate.error };
  await revokeInvite(projectId, toUserId);
  publish(`user:${toUserId}`, { type: "invite" });
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/** Accept an invitation from the notifications page. */
export async function acceptInviteAction(inviteId: string): Promise<CollabState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  // Scoped to the recipient inside the repo — an id alone grants nothing.
  const invite = await consumeInviteFor(inviteId, user.id);
  if (!invite) return { error: "That invitation is no longer valid." };

  await addMember(invite.projectId, {
    userId: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    joinedAt: Date.now(),
  });
  void track(EVENTS.INVITE_ACCEPTED, { userId: user.id });
  publish(`project:${invite.projectId}`, { type: "members" });
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function declineInviteAction(inviteId: string): Promise<CollabState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  await consumeInviteFor(inviteId, user.id);
  revalidatePath("/notifications");
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
  publish(`project:${projectId}`, { type: "members", actorId: user.id });
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
    authorName: user.name ?? user.username,
    anchor,
    body: text,
  });
  publish(`project:${projectId}`, { type: "comment", actorId: user.id });
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
  publish(`project:${projectId}`, { type: "comment", actorId: user.id });
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
