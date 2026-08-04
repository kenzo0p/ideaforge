import { col } from "./index";
import type { PlanId, SubscriptionStatus } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Subscription state.
//
// One row per user. The gateway is the source of truth for *money*; this is the
// source of truth for *access*, updated from verified webhooks. Keeping them
// separate means a gateway outage degrades to "existing subscribers keep
// working" rather than "everyone is locked out".
//
// Every state change is also appended to `billingEvents`, because when someone
// says "I paid and it didn't upgrade" the only useful answer comes from a log.
// ---------------------------------------------------------------------------

export interface Subscription {
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  /** Epoch ms; access survives until this even after cancellation. */
  currentPeriodEnd?: number;
  /** Gateway identifiers, for reconciliation and the customer portal. */
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  cancelAtPeriodEnd?: boolean;
  updatedAt: number;
}

interface SubscriptionDoc extends Subscription {
  _id: string; // userId — one subscription per user
}

interface BillingEventDoc {
  _id: string;
  userId?: string;
  /** Gateway event id, used to make webhook handling idempotent. */
  providerEventId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

const subs = () => col<SubscriptionDoc>("subscriptions");
const events = () => col<BillingEventDoc>("billingEvents");

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const d = await (await subs()).findOne({ _id: userId });
  if (!d) return null;
  const { _id, ...rest } = d;
  void _id;
  return rest;
}

export async function upsertSubscription(input: {
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd?: number;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  cancelAtPeriodEnd?: boolean;
}): Promise<void> {
  // replaceOne rejects _id in the replacement; the filter already pins it.
  await (await subs()).replaceOne(
    { _id: input.userId },
    { ...input, updatedAt: Date.now() },
    { upsert: true },
  );
}

/** Find the account behind a gateway subscription id (webhooks arrive by id). */
export async function findByProviderSubscriptionId(
  providerSubscriptionId: string,
): Promise<Subscription | null> {
  const d = await (await subs()).findOne({ providerSubscriptionId });
  if (!d) return null;
  const { _id, ...rest } = d;
  void _id;
  return rest;
}

export async function setSubscriptionStatus(
  userId: string,
  status: SubscriptionStatus,
  patch: Partial<Pick<Subscription, "currentPeriodEnd" | "cancelAtPeriodEnd">> = {},
): Promise<void> {
  await (await subs()).updateOne(
    { _id: userId },
    { $set: { status, ...patch, updatedAt: Date.now() } },
  );
}

// --- Audit log -------------------------------------------------------------

/**
 * Record a billing event.
 *
 * Returns false when this gateway event was already processed. Gateways retry
 * aggressively and will happily deliver the same event several times; without
 * this check a retried `subscription.charged` could extend a period twice.
 */
export async function recordBillingEvent(input: {
  userId?: string;
  providerEventId?: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const c = await events();
  if (input.providerEventId) {
    const seen = await c.countDocuments({ providerEventId: input.providerEventId }, { limit: 1 });
    if (seen) return false;
  }
  await c.insertOne({
    _id: crypto.randomUUID(),
    ...input,
    createdAt: Date.now(),
  });
  return true;
}

/** Recent events for a user — powers the billing history in settings. */
export async function listBillingEvents(userId: string, limit = 20) {
  return (await events())
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
