// ---------------------------------------------------------------------------
// Plans and entitlements.
//
// One place that answers "what does this tier get?", with no imports, so it can
// be unit-tested and shared by server enforcement and the pricing page. If the
// UI and the enforcement layer read different tables they will disagree, and
// the disagreement will be discovered by a paying customer.
//
// Prices are in paise (₹1 = 100 paise) because every Indian payment gateway
// takes integer minor units — storing rupees as a float is how you end up
// charging ₹399.00000001.
// ---------------------------------------------------------------------------

export type PlanId = "free" | "pro" | "team";

export interface PlanLimits {
  /** Saved projects. Infinity for unlimited. */
  projects: number;
  /** Copilot runs per rolling 24h — the actual cost guardrail. */
  dailyRuns: number;
  /** Collaborators per project, excluding the owner. */
  collaboratorsPerProject: number;
  /** Standing monitors on a problem space. */
  watches: number;
  /** Fastest cadence a watch may run at. */
  fastestCadence: "daily" | "weekly";
}

export interface PlanFeatures {
  /** Side-by-side idea comparison with a ranked verdict. */
  compare: boolean;
  /** Invite people to a project. */
  collaboration: boolean;
  /** Telegram agent and scheduled reminders. */
  agent: boolean;
  /** Push to Notion / Google Docs. */
  integrations: boolean;
  /** Upload a deck for critique. */
  deckReview: boolean;
  /** Priority queue — reserved for future use. */
  priority: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in paise. 0 for free. */
  pricePaise: number;
  tagline: string;
  limits: PlanLimits;
  features: PlanFeatures;
  /** Seats included; Team is sold per workspace, not per head. */
  seats: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    pricePaise: 0,
    tagline: "Enough to validate a real idea end to end.",
    seats: 1,
    // One weekly watch on Free: enough to feel the product still working
    // for you between sessions, which is what makes the upgrade make sense.
    limits: { projects: 3, dailyRuns: 15, collaboratorsPerProject: 0, watches: 1, fastestCadence: "weekly" },
    features: {
      compare: false,
      collaboration: false,
      agent: false,
      integrations: false,
      // Deck review stays free deliberately: it is the feature that makes
      // someone try the product, and it costs one model call.
      deckReview: true,
      priority: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    pricePaise: 39900, // ₹399
    tagline: "For founders and final-year students shipping something real.",
    seats: 1,
    limits: { projects: Infinity, dailyRuns: 100, collaboratorsPerProject: 5, watches: 10, fastestCadence: "daily" },
    features: {
      compare: true,
      collaboration: true,
      agent: true,
      integrations: true,
      deckReview: true,
      priority: false,
    },
  },
  team: {
    id: "team",
    name: "Team",
    pricePaise: 149900, // ₹1,499
    tagline: "For hackathon teams and labs working the same problem.",
    seats: 5,
    limits: { projects: Infinity, dailyRuns: 400, collaboratorsPerProject: 25, watches: 50, fastestCadence: "daily" },
    features: {
      compare: true,
      collaboration: true,
      agent: true,
      integrations: true,
      deckReview: true,
      priority: true,
    },
  },
};

export const DEFAULT_PLAN: PlanId = "free";

/** Ordering, for picking the better of two entitlements. */
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2 };

/**
 * The better of two plans.
 *
 * Someone can hold a personal subscription *and* a seat in an organisation. The
 * higher one wins: a student who already pays for Pro and then joins their
 * department's Team workspace must not be quietly downgraded, and neither
 * should they have to cancel to get the seat they were given.
 */
export function betterPlan(a: Plan, b: Plan): Plan {
  return PLAN_RANK[b.id] > PLAN_RANK[a.id] ? b : a;
}

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id ?? DEFAULT_PLAN) as PlanId] ?? PLANS[DEFAULT_PLAN];
}

/** ₹399 — for UI. Trailing ".00" is noise on whole-rupee prices. */
export function formatPrice(pricePaise: number): string {
  if (pricePaise === 0) return "Free";
  const rupees = pricePaise / 100;
  return `₹${rupees % 1 === 0 ? rupees.toLocaleString("en-IN") : rupees.toFixed(2)}`;
}

/** Human-readable limit, since Infinity renders badly. */
export function formatLimit(value: number): string {
  return Number.isFinite(value) ? String(value) : "Unlimited";
}

// --- Subscription status ---------------------------------------------------

/**
 * Lifecycle of a paid subscription.
 *
 * `past_due` deliberately keeps access: dunning a student whose card failed at
 * 2am by locking their project during a demo loses far more than the ₹399.
 * Access is withdrawn only on `cancelled` or `expired`.
 */
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "pending";

export function statusGrantsAccess(status: SubscriptionStatus): boolean {
  return status === "active" || status === "past_due";
}

/**
 * The plan a user is actually entitled to right now.
 *
 * Paid access needs a status that grants it *and* a period that hasn't ended —
 * a cancelled subscription keeps working until the end of the paid period,
 * which is what people expect and what avoids refund requests.
 */
export function effectivePlan(sub: {
  planId?: string | null;
  status?: SubscriptionStatus | null;
  currentPeriodEnd?: number | null;
} | null): Plan {
  if (!sub?.planId || sub.planId === "free") return PLANS.free;
  if (!sub.status) return PLANS.free;

  const withinPeriod = !sub.currentPeriodEnd || sub.currentPeriodEnd > Date.now();

  // Cancelled but still paid for: honour the remaining period.
  if (sub.status === "cancelled") return withinPeriod ? getPlan(sub.planId) : PLANS.free;
  if (!statusGrantsAccess(sub.status)) return PLANS.free;
  if (!withinPeriod) return PLANS.free;

  return getPlan(sub.planId);
}
