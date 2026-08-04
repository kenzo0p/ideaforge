import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getCurrentUser } from "@/lib/auth/session";
import { getSubscription } from "@/lib/db/subscriptions";
import { listProjects } from "@/lib/db/projects";
import { effectivePlan, type Plan, type PlanFeatures } from "./plans";

// ---------------------------------------------------------------------------
// Entitlements — the single server-side answer to "is this allowed?".
//
// Every gate goes through here. The alternative — each route checking the plan
// itself — is how one endpoint ends up free while its sibling is paid, and how
// a client-side check becomes the only check.
//
// Nothing here trusts the client: the plan is derived from the session user's
// stored subscription, never from anything the browser sent.
// ---------------------------------------------------------------------------

export interface Entitlement {
  allowed: boolean;
  /** Set when refused: what to tell the user, in their terms. */
  reason?: string;
  /** Set when refused because of the tier, so the UI can offer an upgrade. */
  upgradeTo?: "pro" | "team";
}

const ALLOW: Entitlement = { allowed: true };

/** The plan a user is actually on right now. */
export async function planFor(userId: string): Promise<Plan> {
  return effectivePlan(await getSubscription(userId));
}

/** Plan for the signed-in user, or the free plan when signed out. */
export async function currentPlan(): Promise<Plan> {
  const user = await getCurrentUser();
  if (!user) return effectivePlan(null);
  return planFor(user.id);
}

const FEATURE_COPY: Record<keyof PlanFeatures, string> = {
  compare: "Comparing ideas side by side",
  collaboration: "Inviting collaborators",
  agent: "The Telegram agent and reminders",
  integrations: "Sending projects to Notion and Google Docs",
  deckReview: "Deck review",
  priority: "Priority runs",
};

/** Gate a named feature. */
export async function canUseFeature(
  userId: string,
  feature: keyof PlanFeatures,
): Promise<Entitlement> {
  const plan = await planFor(userId);
  if (plan.features[feature]) return ALLOW;
  void track(EVENTS.LIMIT_HIT, { userId, props: { limit: `feature_${feature}`, plan: plan.id } });
  return {
    allowed: false,
    reason: `${FEATURE_COPY[feature]} is a Pro feature.`,
    upgradeTo: "pro",
  };
}

/**
 * Gate creating another project.
 *
 * Counts only projects the user *owns*: being invited onto someone else's work
 * shouldn't consume your own allowance, or a Free user could be locked out of
 * their own account by a generous teammate.
 */
export async function canCreateProject(userId: string): Promise<Entitlement> {
  const plan = await planFor(userId);
  if (!Number.isFinite(plan.limits.projects)) return ALLOW;

  const owned = (await listProjects(userId)).filter((p) => p.isOwner).length;
  if (owned < plan.limits.projects) return ALLOW;

  void track(EVENTS.LIMIT_HIT, { userId, props: { limit: "projects", plan: plan.id } });
  return {
    allowed: false,
    reason: `The ${plan.name} plan saves up to ${plan.limits.projects} projects. Upgrade for unlimited, or delete one to make room.`,
    upgradeTo: "pro",
  };
}

/** Gate adding another collaborator to a project. */
export async function canAddCollaborator(
  userId: string,
  currentCount: number,
): Promise<Entitlement> {
  const plan = await planFor(userId);
  if (!plan.features.collaboration) {
    return {
      allowed: false,
      reason: "Collaboration is a Pro feature.",
      upgradeTo: "pro",
    };
  }
  if (currentCount < plan.limits.collaboratorsPerProject) return ALLOW;
  return {
    allowed: false,
    reason: `The ${plan.name} plan allows ${plan.limits.collaboratorsPerProject} collaborators per project.`,
    upgradeTo: plan.id === "pro" ? "team" : "pro",
  };
}

/**
 * Gate starting another watch.
 *
 * Free gets one weekly monitor. That's deliberate: someone has to experience
 * the product still working for them between sessions before paying for more
 * of it.
 */
export async function canCreateWatch(
  userId: string,
  currentCount: number,
): Promise<Entitlement> {
  const plan = await planFor(userId);
  if (currentCount < plan.limits.watches) return ALLOW;
  return {
    allowed: false,
    reason:
      plan.id === "free"
        ? "Free includes one watch. Upgrade to monitor every project you're working on."
        : `The ${plan.name} plan allows ${plan.limits.watches} watches.`,
    upgradeTo: plan.id === "free" ? "pro" : "team",
  };
}

/** Whether this tier may run a watch at the requested cadence. */
export async function canUseCadence(
  userId: string,
  cadence: "daily" | "weekly",
): Promise<Entitlement> {
  const plan = await planFor(userId);
  if (cadence === "weekly" || plan.limits.fastestCadence === "daily") return ALLOW;
  return {
    allowed: false,
    reason: "Daily checks are a Pro feature — Free watches run weekly.",
    upgradeTo: "pro",
  };
}

/** The daily copilot-run ceiling for this user's tier. */
export async function dailyRunLimit(userId: string): Promise<number> {
  return (await planFor(userId)).limits.dailyRuns;
}
