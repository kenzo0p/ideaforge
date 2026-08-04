import { randomUUID } from "node:crypto";
import { col } from "./index";
import { domainOf } from "@/lib/orgs/domains";
import type { PlanId, SubscriptionStatus } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Organisations — the institutional side of the business.
//
// A consumer subscription is one person deciding to keep paying every month. An
// organisation is a department that bought seats for a cohort: one sale, many
// users, and renewal driven by the academic calendar rather than by whether an
// individual remembered the product this month.
//
// Two collections rather than an embedded member array. Membership is queried
// from the *user* side on every gated request ("what plan is this person on?"),
// and an embedded array would mean scanning every org document to answer that.
// ---------------------------------------------------------------------------

export type OrgRole = "owner" | "mentor" | "member";

export interface Org {
  id: string;
  name: string;
  slug: string;
  /** Domains whose addresses join automatically. Verified at claim time. */
  emailDomains: string[];
  planId: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd?: number;
  /** Head count the org has paid for. Separate from the plan so a campus deal
   *  can be 200 seats without inventing a new tier for every contract size. */
  seats: number;
  /** Gateway subscription behind the workspace's plan, for webhook lookup. */
  providerSubscriptionId?: string;
  createdBy: string;
  createdAt: number;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: number;
  /** How they got in — useful when someone asks why they're in a workspace. */
  via: "created" | "domain" | "invite";
}

interface OrgDoc extends Omit<Org, "id"> {
  _id: string;
}

interface MemberDoc extends OrgMember {
  _id: string;
}

const orgs = () => col<OrgDoc>("orgs");
const members = () => col<MemberDoc>("orgMembers");

function toOrg(d: OrgDoc): Org {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

/** URL-safe handle derived from the name, uniquified with a short suffix. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return base || "workspace";
}

// --- Reads -----------------------------------------------------------------

export async function getOrg(orgId: string): Promise<Org | null> {
  const d = await (await orgs()).findOne({ _id: orgId });
  return d ? toOrg(d) : null;
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const d = await (await orgs()).findOne({ slug });
  return d ? toOrg(d) : null;
}

/**
 * The org a user belongs to, with their role.
 *
 * One membership per person. Multi-org would need a workspace switcher in every
 * surface that shows a plan, and nothing in the product needs it yet — the
 * unique index on userId is what keeps that assumption honest.
 */
export async function membershipFor(
  userId: string,
): Promise<{ org: Org; role: OrgRole } | null> {
  const m = await (await members()).findOne({ userId });
  if (!m) return null;
  const org = await getOrg(m.orgId);
  if (!org) return null;
  return { org, role: m.role };
}

export async function listOrgMembers(
  orgId: string,
): Promise<(OrgMember & { name: string | null; username: string; email: string })[]> {
  const rows = await (await members())
    .aggregate<MemberDoc & { user?: { name?: string | null; username: string; email: string }[] }>([
      { $match: { orgId } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
          pipeline: [{ $project: { name: 1, username: 1, email: 1 } }],
        },
      },
      { $sort: { joinedAt: 1 } },
    ])
    .toArray();

  return rows.map((r) => ({
    orgId: r.orgId,
    userId: r.userId,
    role: r.role,
    joinedAt: r.joinedAt,
    via: r.via,
    name: r.user?.[0]?.name ?? null,
    username: r.user?.[0]?.username ?? "unknown",
    email: r.user?.[0]?.email ?? "",
  }));
}

export async function countOrgMembers(orgId: string): Promise<number> {
  return (await members()).countDocuments({ orgId });
}

export async function roleIn(orgId: string, userId: string): Promise<OrgRole | null> {
  const m = await (await members()).findOne({ orgId, userId }, { projection: { role: 1 } });
  return m?.role ?? null;
}

// --- Writes ----------------------------------------------------------------

/**
 * Create an organisation and make the creator its owner.
 *
 * The creating account starts on whatever plan the org is given, which is the
 * point: buying a workspace shouldn't require also buying a personal seat.
 */
export async function createOrg(input: {
  name: string;
  createdBy: string;
  planId?: PlanId;
  seats?: number;
  emailDomains?: string[];
}): Promise<Org> {
  const id = randomUUID();
  const now = Date.now();

  // Slugs are only cosmetic, but a collision would make two workspaces share a
  // URL, so uniqueness is settled here rather than left to the index to reject.
  const base = slugify(input.name);
  let slug = base;
  for (let n = 2; await (await orgs()).countDocuments({ slug }, { limit: 1 }); n++) {
    slug = `${base}-${n}`;
  }

  const doc: OrgDoc = {
    _id: id,
    name: input.name,
    slug,
    emailDomains: input.emailDomains ?? [],
    // A new workspace is free until someone pays for it. Defaulting to Team
    // would hand out the most expensive plan to anyone who typed a name.
    planId: input.planId ?? "free",
    status: "active",
    seats: input.seats ?? 5,
    createdBy: input.createdBy,
    createdAt: now,
  };
  await (await orgs()).insertOne(doc);
  await addOrgMember(id, input.createdBy, "owner", "created");
  return toOrg(doc);
}

/**
 * Add someone to an org.
 *
 * Idempotent: the unique index on userId means a second attempt is a duplicate
 * key rather than a second membership, and re-joining is not an error worth
 * showing anyone.
 */
export async function addOrgMember(
  orgId: string,
  userId: string,
  role: OrgRole,
  via: OrgMember["via"],
): Promise<boolean> {
  try {
    await (await members()).insertOne({
      _id: randomUUID(),
      orgId,
      userId,
      role,
      joinedAt: Date.now(),
      via,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** Remove someone. The last owner can't be removed — that would strand the org. */
export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  const c = await members();
  const target = await c.findOne({ orgId, userId });
  if (!target) return false;
  if (target.role === "owner" && (await c.countDocuments({ orgId, role: "owner" })) <= 1) {
    return false;
  }
  const res = await c.deleteOne({ orgId, userId });
  return res.deletedCount > 0;
}

/** Change a member's role, with the same last-owner protection. */
export async function setOrgRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<boolean> {
  const c = await members();
  const target = await c.findOne({ orgId, userId });
  if (!target) return false;
  if (
    target.role === "owner" &&
    role !== "owner" &&
    (await c.countDocuments({ orgId, role: "owner" })) <= 1
  ) {
    return false;
  }
  const res = await c.updateOne({ orgId, userId }, { $set: { role } });
  return res.modifiedCount > 0;
}

/**
 * Claim a domain. Returns false when another workspace already holds it.
 *
 * The unique partial index on `emailDomains` is what actually enforces this;
 * checking first would leave a race in which two orgs claim a domain at the
 * same moment and both believe they own everyone on it.
 */
/**
 * Repair a workspace after someone leaves it by deleting their account.
 *
 * Account deletion bypasses `removeOrgMember`'s last-owner rule — it has to, or
 * a professor couldn't close their account. So the rule is restored here
 * instead: the longest-standing member is promoted, and a workspace nobody is
 * left in is removed entirely. That last part matters beyond tidiness: an empty
 * org would keep holding its domain claim forever, and the unique index means
 * nobody else could ever claim it.
 */
export async function reconcileOrgOwnership(orgId: string): Promise<void> {
  const c = await members();
  if (await c.countDocuments({ orgId, role: "owner" }, { limit: 1 })) return;

  const heir = await c.find({ orgId }).sort({ joinedAt: 1 }).limit(1).next();
  if (!heir) {
    await (await orgs()).deleteOne({ _id: orgId });
    return;
  }
  await c.updateOne({ _id: heir._id }, { $set: { role: "owner" } });
}

export async function addOrgDomain(orgId: string, domain: string): Promise<boolean> {
  try {
    await (await orgs()).updateOne({ _id: orgId }, { $addToSet: { emailDomains: domain } });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function removeOrgDomain(orgId: string, domain: string): Promise<void> {
  await (await orgs()).updateOne({ _id: orgId }, { $pull: { emailDomains: domain } });
}

export async function setOrgPlan(input: {
  orgId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd?: number;
  seats?: number;
  providerSubscriptionId?: string;
}): Promise<void> {
  const { orgId, ...patch } = input;
  await (await orgs()).updateOne({ _id: orgId }, { $set: patch });
}

/** Webhooks arrive by gateway id, not by workspace. */
export async function findOrgByProviderSubscriptionId(id: string): Promise<Org | null> {
  const d = await (await orgs()).findOne({ providerSubscriptionId: id });
  return d ? toOrg(d) : null;
}

/** Apply a lifecycle change from a verified webhook to a workspace. */
export async function setOrgSubscriptionStatus(
  orgId: string,
  status: SubscriptionStatus,
  patch: { currentPeriodEnd?: number } = {},
): Promise<void> {
  await (await orgs()).updateOne({ _id: orgId }, { $set: { status, ...patch } });
}

// --- Domain auto-join ------------------------------------------------------

export type JoinOutcome =
  | { joined: true; org: Org }
  | { joined: false; reason: "no-match" | "already-member" | "full" };

/**
 * Put a user into the org that owns their email domain, if there is one.
 *
 * Called on sign-up *and* sign-in. Sign-in matters as much: an institution that
 * buys a workspace after its students have already signed up would otherwise
 * have to chase every one of them for an invitation.
 *
 * Never throws — a failure here must not stop someone signing in.
 */
export async function autoJoinByDomain(userId: string, email: string): Promise<JoinOutcome> {
  const domain = domainOf(email);
  if (!domain) return { joined: false, reason: "no-match" };

  const existing = await (await members()).countDocuments({ userId }, { limit: 1 });
  if (existing) return { joined: false, reason: "already-member" };

  const d = await (await orgs()).findOne({ emailDomains: domain });
  if (!d) return { joined: false, reason: "no-match" };

  // Seats are enforced here rather than at the door, because this is the only
  // path that adds people without anyone deciding to. An org that outgrows its
  // seat count stops absorbing new signups instead of quietly overspending.
  if ((await countOrgMembers(d._id)) >= d.seats) return { joined: false, reason: "full" };

  const added = await addOrgMember(d._id, userId, "member", "domain");
  return added ? { joined: true, org: toOrg(d) } : { joined: false, reason: "already-member" };
}

// --- Mentor access ---------------------------------------------------------

/**
 * Whether `viewerId` may read `ownerId`'s work as a mentor.
 *
 * Deliberately narrow: same org, and the viewer holds owner or mentor. A plain
 * member cannot read a peer's projects — a workspace is not a shared folder,
 * and students would stop using it honestly if it were.
 */
export async function canMentorView(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const c = await members();
  const viewer = await c.findOne({ userId: viewerId }, { projection: { orgId: 1, role: 1 } });
  if (!viewer || viewer.role === "member") return false;
  const owned = await c.countDocuments(
    { userId: ownerId, orgId: viewer.orgId },
    { limit: 1 },
  );
  return owned > 0;
}

/** Every member's project activity — the mentor dashboard's only query. */
export async function orgProjectOverview(orgId: string): Promise<
  {
    userId: string;
    name: string | null;
    username: string;
    role: OrgRole;
    projects: number;
    validated: number;
    withPlan: number;
    lastActiveAt: number | null;
  }[]
> {
  return (await members())
    .aggregate<{
      userId: string;
      name: string | null;
      username: string;
      role: OrgRole;
      projects: number;
      validated: number;
      withPlan: number;
      lastActiveAt: number | null;
    }>([
      { $match: { orgId } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
          pipeline: [{ $project: { name: 1, username: 1 } }],
        },
      },
      {
        $lookup: {
          from: "projects",
          localField: "userId",
          foreignField: "userId",
          as: "projects",
          // Only the three fields the summary needs: a mentor overview must
          // never pull research bodies for a whole cohort across the wire.
          pipeline: [
            {
              $project: {
                updatedAt: 1,
                hasValidation: { $gt: [{ $strLenCP: { $ifNull: ["$validationMarkdown", ""] } }, 0] },
                hasPlan: { $ne: [{ $ifNull: ["$plan", null] }, null] },
              },
            },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          userId: 1,
          role: 1,
          name: { $ifNull: [{ $first: "$user.name" }, null] },
          username: { $ifNull: [{ $first: "$user.username" }, "unknown"] },
          projects: { $size: "$projects" },
          validated: {
            $size: { $filter: { input: "$projects", cond: "$$this.hasValidation" } },
          },
          withPlan: { $size: { $filter: { input: "$projects", cond: "$$this.hasPlan" } } },
          lastActiveAt: { $max: "$projects.updatedAt" },
        },
      },
      { $sort: { lastActiveAt: -1, username: 1 } },
    ])
    .toArray();
}

/** A member's projects, for the mentor drill-down. Summary fields only. */
export async function memberProjects(
  ownerId: string,
): Promise<{ id: string; title: string; idea: string; updatedAt: number; hasPlan: boolean }[]> {
  const rows = await col<{
    _id: string;
    title: string;
    idea: string;
    updatedAt: number;
    plan?: unknown;
  }>("projects").then((c) =>
    c
      .find({ userId: ownerId }, { projection: { title: 1, idea: 1, updatedAt: 1, plan: 1 } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray(),
  );
  return rows.map((r) => ({
    id: r._id,
    title: r.title,
    idea: r.idea,
    updatedAt: r.updatedAt,
    hasPlan: r.plan != null,
  }));
}
