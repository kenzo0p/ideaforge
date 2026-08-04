import { getSubscription } from "@/lib/db/subscriptions";
import { membershipFor } from "@/lib/db/orgs";
import { betterPlan, effectivePlan, type Plan } from "./plans";

// ---------------------------------------------------------------------------
// Resolving a user's plan.
//
// Split out from entitlements.ts so it can be exercised directly: entitlements
// pulls in the session helper, which needs `next/headers` and therefore a
// running Next server. The most important rule in the billing system — which
// plan wins when someone has two — deserves to be testable without one.
// ---------------------------------------------------------------------------

/**
 * The plan a user is actually on right now.
 *
 * Two sources: what they bought themselves, and what the organisation they
 * belong to bought for them. The better of the two applies — a student already
 * paying for Pro who then joins their department's Team workspace must not be
 * quietly downgraded, and shouldn't have to cancel to use the seat they were
 * given.
 *
 * The org lookup is one indexed query against a collection most users have no
 * row in. That is the price of not denormalising a plan onto every user and
 * then having to keep it in sync from two separate webhook paths.
 */
export async function planFor(userId: string): Promise<Plan> {
  const [personal, membership] = await Promise.all([
    getSubscription(userId),
    membershipFor(userId),
  ]);
  const own = effectivePlan(personal);
  if (!membership) return own;
  return betterPlan(own, effectivePlan(membership.org));
}
