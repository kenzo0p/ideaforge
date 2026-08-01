import { randomUUID } from "node:crypto";
import { col } from "./index";

// ---------------------------------------------------------------------------
// Collaboration: invitations and comments.
//
// Members live on the project document (see projects.ts) because they're read
// with it on every access check. Invitations and comments get their own
// collections: invitations are short-lived and looked up by token, and comments
// grow without bound, which is exactly what you don't want inside a document
// that is fetched in full on every page load.
// ---------------------------------------------------------------------------

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * An invitation addressed to an existing account.
 *
 * There is no emailed token any more: the invitee already has an account, so
 * the invitation is a row they see in their own notifications and accept from
 * inside the app. Nothing leaves the system, and no mail provider is involved.
 */
export interface ProjectInvite {
  id: string;
  projectId: string;
  projectTitle: string;
  toUserId: string;
  toUsername: string;
  invitedByName: string;
  invitedByUsername: string;
  createdAt: number;
  expiresAt: number;
}

interface InviteDoc {
  _id: string;
  projectId: string;
  projectTitle: string;
  toUserId: string;
  toUsername: string;
  invitedByUserId: string;
  invitedByName: string;
  invitedByUsername: string;
  createdAt: number;
  /** Date, so the TTL index reaps stale invitations. */
  expiresAt: Date;
}

/** Which part of the project a comment is attached to. */
export type CommentAnchor = "validation" | "research" | "plan" | "workspace" | "general";

export interface ProjectComment {
  id: string;
  projectId: string;
  userId: string;
  authorName: string;
  anchor: CommentAnchor;
  body: string;
  createdAt: number;
}

interface CommentDoc {
  _id: string;
  projectId: string;
  userId: string;
  authorName: string;
  anchor: CommentAnchor;
  body: string;
  createdAt: number;
}

const invites = () => col<InviteDoc>("projectInvites");
const comments = () => col<CommentDoc>("projectComments");

// --- Invitations -----------------------------------------------------------

/**
 * Create (or refresh) an invitation for one address on one project.
 *
 * Re-inviting the same address replaces the old token rather than stacking
 * another, so a resent invite invalidates the first — a link someone forwarded
 * on can't outlive the one you meant to send.
 */
function toInvite(d: InviteDoc): ProjectInvite {
  return {
    id: d._id,
    projectId: d.projectId,
    projectTitle: d.projectTitle,
    toUserId: d.toUserId,
    toUsername: d.toUsername,
    invitedByName: d.invitedByName,
    invitedByUsername: d.invitedByUsername,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt.getTime(),
  };
}

export async function createInvite(input: {
  projectId: string;
  projectTitle: string;
  toUserId: string;
  toUsername: string;
  invitedByUserId: string;
  invitedByName: string;
  invitedByUsername: string;
}): Promise<ProjectInvite> {
  const c = await invites();
  // One live invitation per person per project — re-inviting refreshes it.
  await c.deleteMany({ projectId: input.projectId, toUserId: input.toUserId });

  const now = Date.now();
  const doc: InviteDoc = {
    _id: randomUUID(),
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    toUserId: input.toUserId,
    toUsername: input.toUsername,
    invitedByUserId: input.invitedByUserId,
    invitedByName: input.invitedByName,
    invitedByUsername: input.invitedByUsername,
    createdAt: now,
    expiresAt: new Date(now + INVITE_TTL_MS),
  };
  await c.insertOne(doc);
  return toInvite(doc);
}

/** Invitations waiting for this person — drives the notifications badge. */
export async function listInvitesForUser(userId: string): Promise<ProjectInvite[]> {
  const docs = await (await invites())
    .find({ toUserId: userId, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toInvite);
}

/**
 * Accept or decline. Scoped to the recipient, so possessing an id is not enough
 * — only the person it was addressed to can act on it.
 */
export async function consumeInviteFor(
  inviteId: string,
  userId: string,
): Promise<ProjectInvite | null> {
  const d = await (await invites()).findOneAndDelete({ _id: inviteId, toUserId: userId });
  if (!d || d.expiresAt.getTime() < Date.now()) return null;
  return toInvite(d);
}

/** Outstanding invitations on a project, for the owner's members list. */
export async function listInvites(projectId: string): Promise<ProjectInvite[]> {
  const docs = await (await invites())
    .find({ projectId, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toInvite);
}

export async function revokeInvite(projectId: string, toUserId: string): Promise<void> {
  await (await invites()).deleteMany({ projectId, toUserId });
}

// --- Comments --------------------------------------------------------------

export async function addComment(input: {
  projectId: string;
  userId: string;
  authorName: string;
  anchor: CommentAnchor;
  body: string;
}): Promise<ProjectComment> {
  const doc: CommentDoc = {
    _id: randomUUID(),
    projectId: input.projectId,
    userId: input.userId,
    authorName: input.authorName,
    anchor: input.anchor,
    body: input.body,
    createdAt: Date.now(),
  };
  await (await comments()).insertOne(doc);
  return { ...doc, id: doc._id };
}

/** Comments on a project, oldest first so a thread reads top to bottom. */
export async function listComments(projectId: string): Promise<ProjectComment[]> {
  const docs = await (await comments())
    .find({ projectId })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  return docs.map((d) => ({ ...d, id: d._id }));
}

/** Delete a comment. Only its author can; the caller supplies the actor. */
export async function deleteComment(id: string, userId: string): Promise<boolean> {
  const res = await (await comments()).deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}

/** Remove everything attached to a project (called when the project is deleted). */
export async function purgeCollaboration(projectId: string): Promise<void> {
  await Promise.all([
    (await invites()).deleteMany({ projectId }),
    (await comments()).deleteMany({ projectId }),
  ]);
}
