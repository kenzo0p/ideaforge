import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "./plans";

// ---------------------------------------------------------------------------
// Payment provider abstraction — same swappable pattern as AI/search/email.
//
// Razorpay is the real implementation: pricing is in rupees, and it's the
// gateway Indian students can actually get approved for. A Mock provider stands
// in when no keys are configured, so the whole upgrade flow — checkout, webhook,
// entitlement change — is exercisable in development and in a demo without
// taking a payment.
//
// The mock is deliberately obvious rather than silent: it labels itself, and
// the UI says the subscription is simulated.
// ---------------------------------------------------------------------------

export interface CheckoutSession {
  /** Where to send the browser to pay. */
  url?: string;
  /** Razorpay Checkout is opened client-side from these. */
  subscriptionId?: string;
  keyId?: string;
  /** True when no real money will move. */
  simulated: boolean;
}

export interface WebhookEvent {
  id: string;
  type: string;
  providerSubscriptionId?: string;
  status?: string;
  currentPeriodEnd?: number;
  raw: Record<string, unknown>;
}

export interface BillingProvider {
  readonly id: string;
  readonly isMock: boolean;
  /** Start an upgrade. */
  createSubscription(input: {
    planId: PlanId;
    userId: string;
    email: string;
    /** "org" buys a workspace's plan rather than a personal seat. */
    scope?: "user" | "org";
  }): Promise<CheckoutSession>;
  /** Ask the gateway to stop renewing. */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /** Verify and parse a webhook. Returns null when the signature is wrong. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent | null;
}

// --- Razorpay ---------------------------------------------------------------

const RZP_API = "https://api.razorpay.com/v1";

/** Razorpay plan ids are created in their dashboard and mapped by env. */
function razorpayPlanId(planId: PlanId): string | undefined {
  return planId === "pro"
    ? process.env.RAZORPAY_PLAN_PRO
    : planId === "team"
      ? process.env.RAZORPAY_PLAN_TEAM
      : undefined;
}

class RazorpayProvider implements BillingProvider {
  readonly id = "razorpay";
  readonly isMock = false;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(keyId: string, keySecret: string, webhookSecret: string) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
  }

  private auth(): string {
    return Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
  }

  async createSubscription(input: {
    planId: PlanId;
    userId: string;
    email: string;
    scope?: "user" | "org";
  }): Promise<CheckoutSession> {
    const plan = razorpayPlanId(input.planId);
    if (!plan) throw new Error(`No Razorpay plan configured for "${input.planId}".`);

    const res = await fetch(`${RZP_API}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: plan,
        // 12 months; renewal continues past this via the dashboard settings.
        total_count: 12,
        customer_notify: 1,
        // Echoed back on every webhook, which is how an event finds its user
        // without a lookup table.
        notes: {
          userId: input.userId,
          email: input.email,
          appPlan: input.planId,
          // Carried for reconciliation only. What a webhook applies to is
          // decided by which record holds the subscription id, never by a note
          // the gateway echoes back.
          scope: input.scope ?? "user",
        },
      }),
    });

    if (!res.ok) {
      // The body can contain key material; log status only.
      console.error("Razorpay subscription create failed:", res.status);
      throw new Error("Could not start checkout. Try again in a moment.");
    }

    const data = (await res.json()) as { id: string; short_url?: string };
    return {
      subscriptionId: data.id,
      keyId: this.keyId,
      url: data.short_url,
      simulated: false,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    const res = await fetch(`${RZP_API}/subscriptions/${providerSubscriptionId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth()}`,
        "Content-Type": "application/json",
      },
      // Let them keep what they paid for.
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    if (!res.ok) {
      console.error("Razorpay cancel failed:", res.status);
      throw new Error("Could not cancel the subscription. Try again.");
    }
  }

  /**
   * Verify the webhook signature before trusting a single field.
   *
   * Without this the endpoint is "anyone on the internet can grant themselves
   * Pro by POSTing JSON". Compared in constant time so the check can't be
   * probed byte by byte.
   */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent | null {
    if (!signature) return null;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const body = JSON.parse(rawBody) as {
      event: string;
      payload?: { subscription?: { entity?: Record<string, unknown> } };
    };
    const sub = body.payload?.subscription?.entity;

    return {
      // Razorpay has no top-level event id; the subscription id plus the event
      // name and its timestamp is stable enough to dedupe retries.
      id: `${body.event}:${sub?.id ?? "none"}:${sub?.current_end ?? sub?.status ?? ""}`,
      type: body.event,
      providerSubscriptionId: typeof sub?.id === "string" ? sub.id : undefined,
      status: typeof sub?.status === "string" ? sub.status : undefined,
      currentPeriodEnd:
        typeof sub?.current_end === "number" ? sub.current_end * 1000 : undefined,
      raw: body as unknown as Record<string, unknown>,
    };
  }
}

// --- Mock -------------------------------------------------------------------

/**
 * Stand-in used when no gateway is configured.
 *
 * Upgrades apply immediately and are clearly labelled as simulated. This exists
 * so the tier logic — gates, limits, downgrade on expiry — can be demonstrated
 * and tested without a live merchant account.
 */
class MockBillingProvider implements BillingProvider {
  readonly id = "mock";
  readonly isMock = true;

  async createSubscription(input: {
    planId: PlanId;
    userId: string;
    scope?: "user" | "org";
  }): Promise<CheckoutSession> {
    // The scope has to survive the round trip, or the simulated "payment"
    // upgrades a personal seat when the owner was buying the workspace.
    const scope = input.scope === "org" ? "&scope=org" : "";
    return {
      url: `/api/billing/simulate?plan=${input.planId}${scope}`,
      subscriptionId: `mock_sub_${input.userId.slice(0, 8)}_${input.planId}`,
      simulated: true,
    };
  }

  async cancelSubscription(): Promise<void> {
    /* nothing to call */
  }

  parseWebhook(): WebhookEvent | null {
    // A mock must never accept real webhooks — that would be an unauthenticated
    // path to granting a paid plan.
    return null;
  }
}

let cached: BillingProvider | null = null;

/**
 * Whether the simulated-payment path may be used.
 *
 * The mock provider grants a plan immediately with no money involved, which is
 * exactly what you want for demos and tests and exactly what you do not want
 * reachable on a live deployment: with no gateway configured, anyone signed in
 * could visit /api/billing/simulate?plan=team and award themselves the top tier.
 *
 * Outside production it stays on, because simulation is the only way to
 * exercise the tier logic at all. In production it takes a deliberate opt-in —
 * still available for a demo deployment, but never by omission.
 */
export function simulatedBillingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  const flag = env.ALLOW_SIMULATED_BILLING?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/** Can this deployment actually take an upgrade? */
export function billingPayable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !getBillingProvider().isMock || simulatedBillingAllowed(env);
}

export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
  cached =
    RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && RAZORPAY_WEBHOOK_SECRET
      ? new RazorpayProvider(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET)
      : new MockBillingProvider();
  return cached;
}

/** Razorpay subscription status → our access status. */
export function mapProviderStatus(status: string | undefined): {
  status: "active" | "past_due" | "cancelled" | "expired" | "pending";
} {
  switch (status) {
    case "active":
    case "authenticated":
      return { status: "active" };
    case "halted":
    case "paused":
      return { status: "past_due" };
    case "cancelled":
      return { status: "cancelled" };
    case "completed":
    case "expired":
      return { status: "expired" };
    default:
      return { status: "pending" };
  }
}
