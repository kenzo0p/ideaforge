import { randomBytes, randomUUID } from "node:crypto";
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

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface ProjectInvite {
  token: string;
  projectId: string;
  email: string;
  invitedByName: string;
  createdAt: number;
  expiresAt: number;
}

interface InviteDoc {
  _id: string;
  projectId: string;
  email: string;
  invitedByUserId: string;
  invitedByName: string;
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
export async function createInvite(input: {
  projectId: string;
  email: string;
  invitedByUserId: string;
  invitedByName: string;
}): Promise<ProjectInvite> {
  const c = await invites();
  const email = input.email.trim().toLowerCase();
  await c.deleteMany({ projectId: input.projectId, email });

  const now = Date.now();
  const doc: InviteDoc = {
    _id: randomBytes(24).toString("hex"),
    projectId: input.projectId,
    email,
    invitedByUserId: input.invitedByUserId,
    invitedByName: input.invitedByName,
    createdAt: now,
    expiresAt: new Date(now + INVITE_TTL_MS),
  };
  await c.insertOne(doc);
  return {
    token: doc._id,
    projectId: doc.projectId,
    email: doc.email,
    invitedByName: doc.invitedByName,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt.getTime(),
  };
}

/** Read an invitation without consuming it (to render the accept screen). */
export async function peekInvite(token: string): Promise<ProjectInvite | null> {
  const d = await (await invites()).findOne({ _id: token });
  // TTL sweeps are periodic, so check the deadline ourselves too.
  if (!d || d.expiresAt.getTime() < Date.now()) return null;
  return {
    token: d._id,
    projectId: d.projectId,
    email: d.email,
    invitedByName: d.invitedByName,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt.getTime(),
  };
}

/** Consume an invitation. Single use — the token dies whether or not it was valid. */
export async function consumeInvite(token: string): Promise<ProjectInvite | null> {
  const d = await (await invites()).findOneAndDelete({ _id: token });
  if (!d || d.expiresAt.getTime() < Date.now()) return null;
  return {
    token: d._id,
    projectId: d.projectId,
    email: d.email,
    invitedByName: d.invitedByName,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt.getTime(),
  };
}

/** Outstanding invitations on a project, for the owner's members list. */
export async function listInvites(projectId: string): Promise<ProjectInvite[]> {
  const docs = await (await invites())
    .find({ projectId, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((d) => ({
    token: d._id,
    projectId: d.projectId,
    email: d.email,
    invitedByName: d.invitedByName,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt.getTime(),
  }));
}

export async function revokeInvite(projectId: string, email: string): Promise<void> {
  await (await invites()).deleteMany({ projectId, email: email.trim().toLowerCase() });
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
