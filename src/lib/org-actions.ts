"use server";

import { revalidatePath } from "next/cache";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/db/users";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { domainOf, rejectDomainClaim } from "@/lib/orgs/domains";
import {
  addOrgDomain,
  addOrgMember,
  autoJoinByDomain,
  countOrgMembers,
  createOrg,
  membershipFor,
  removeOrgDomain,
  removeOrgMember,
  setOrgRole,
  type OrgRole,
} from "@/lib/db/orgs";

// ---------------------------------------------------------------------------
// Organisation management.
//
// Every action re-derives the caller's role from the session. None of them take
// an orgId from the client: a workspace id in a form field is an invitation to
// administer someone else's workspace.
// ---------------------------------------------------------------------------

export interface OrgState {
  error?: string;
  ok?: boolean;
  /** Set when the refusal is a seat limit, so the UI can offer more seats. */
  upgradeTo?: "pro" | "team";
}

/** Resolve the caller's membership, requiring at least the given role. */
async function requireRole(
  minimum: Exclude<OrgRole, "member">,
): Promise<{ orgId: string; userId: string; email: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const membership = await membershipFor(user.id);
  if (!membership) return { error: "You're not in a workspace." };

  const rank: Record<OrgRole, number> = { member: 0, mentor: 1, owner: 2 };
  if (rank[membership.role] < rank[minimum]) {
    return { error: `Only a workspace ${minimum} can do that.` };
  }
  return { orgId: membership.org.id, userId: user.id, email: user.email };
}

export async function createOrgAction(name: string): Promise<OrgState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const clean = name.trim().slice(0, 80);
  if (clean.length < 2) return { error: "Give the workspace a name." };

  // One workspace per person, so creating a second would silently orphan the
  // first from this account's point of view.
  if (await membershipFor(user.id)) {
    return { error: "You're already in a workspace. Leave it before creating another." };
  }

  const org = await createOrg({ name: clean, createdBy: user.id });
  void track(EVENTS.ORG_CREATED, { userId: user.id, props: { plan: org.planId } });
  revalidatePath("/org");
  return { ok: true };
}

/**
 * Claim an email domain for the workspace.
 *
 * The claim is checked against the caller's *own* verified address — see
 * `rejectDomainClaim`. This is the whole security model for auto-join, so the
 * check lives one call away from the write.
 */
export async function addOrgDomainAction(domain: string): Promise<OrgState> {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate;

  const clean = domain.trim().toLowerCase().replace(/^@/, "");
  const reason = rejectDomainClaim(clean, gate.email);
  if (reason) return { error: reason };

  const normalized = domainOf(`x@${clean}`)!;
  const claimed = await addOrgDomain(gate.orgId, normalized);
  if (!claimed) return { error: `${normalized} is already claimed by another workspace.` };

  revalidatePath("/org");
  return { ok: true };
}

export async function removeOrgDomainAction(domain: string): Promise<OrgState> {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate;
  await removeOrgDomain(gate.orgId, domain);
  revalidatePath("/org");
  return { ok: true };
}

/** Add someone by username, for people whose address isn't on a claimed domain. */
export async function addOrgMemberAction(username: string, role: OrgRole = "member"): Promise<OrgState> {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate;

  const handle = normalizeUsername(username);
  const invalid = validateUsername(handle);
  if (invalid) return { error: invalid };

  const target = await getUserByUsername(handle);
  if (!target) return { error: `No one here goes by @${handle}.` };
  if (await membershipFor(target.id)) {
    return { error: `@${handle} is already in a workspace.` };
  }

  const [org, used] = await Promise.all([
    membershipFor(gate.userId),
    countOrgMembers(gate.orgId),
  ]);
  if (org && used >= org.org.seats) {
    return {
      error: `All ${org.org.seats} seats are taken. Free one up, or add seats to keep growing.`,
      upgradeTo: "team",
    };
  }

  const added = await addOrgMember(gate.orgId, target.id, role, "invite");
  if (!added) return { error: `@${handle} is already in this workspace.` };

  void track(EVENTS.ORG_MEMBER_JOINED, { userId: target.id, props: { via: "invite", role } });
  revalidatePath("/org");
  return { ok: true };
}

export async function setOrgRoleAction(userId: string, role: OrgRole): Promise<OrgState> {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate;

  const changed = await setOrgRole(gate.orgId, userId, role);
  if (!changed) return { error: "A workspace needs at least one owner." };
  revalidatePath("/org");
  return { ok: true };
}

export async function removeOrgMemberAction(userId: string): Promise<OrgState> {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate;

  const removed = await removeOrgMember(gate.orgId, userId);
  if (!removed) return { error: "A workspace needs at least one owner." };
  revalidatePath("/org");
  return { ok: true };
}

/**
 * Leave the workspace you're in.
 *
 * Available to everyone, including owners — provided they aren't the last one.
 * Someone who joined by domain and doesn't want to be there must have a way out
 * that doesn't involve emailing an administrator.
 */
export async function leaveOrgAction(): Promise<OrgState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const membership = await membershipFor(user.id);
  if (!membership) return { error: "You're not in a workspace." };

  const removed = await removeOrgMember(membership.org.id, user.id);
  if (!removed) {
    return { error: "You're the last owner — make someone else an owner first." };
  }
  revalidatePath("/org");
  return { ok: true };
}

/** Re-run the domain match on demand, for someone whose org was created later. */
export async function refreshOrgMembershipAction(): Promise<OrgState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };
  if (!user.emailVerified) return { error: "Verify your email address first." };

  const outcome = await autoJoinByDomain(user.id, user.email);
  if (!outcome.joined) {
    return {
      error:
        outcome.reason === "full"
          ? "That workspace has no seats left."
          : "No workspace has claimed your email domain.",
    };
  }
  void track(EVENTS.ORG_MEMBER_JOINED, { userId: user.id, props: { via: "domain" } });
  revalidatePath("/org");
  return { ok: true };
}
