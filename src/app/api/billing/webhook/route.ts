import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getBillingProvider, mapProviderStatus } from "@/lib/billing/provider";
import {
  findByProviderSubscriptionId,
  recordBillingEvent,
  setSubscriptionStatus,
} from "@/lib/db/subscriptions";
import { findOrgByProviderSubscriptionId, setOrgSubscriptionStatus } from "@/lib/db/orgs";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook — subscription lifecycle from the gateway.
 *
 * This endpoint decides who has a paid plan, so it is the highest-value target
 * in the app. Two rules follow:
 *   1. Nothing in the body is trusted until the HMAC signature verifies.
 *   2. Every event is deduped, because gateways retry and a replayed
 *      `charged` event must not extend a billing period twice.
 *
 * It always returns 200 after a valid signature — a non-2xx makes the gateway
 * retry forever over something we've already recorded.
 */
export async function POST(req: Request) {
  const provider = getBillingProvider();

  // Raw body: re-serialising JSON changes bytes and breaks the signature.
  const raw = await req.text();
  const signature =
    req.headers.get("x-razorpay-signature") ?? req.headers.get("x-signature");

  const event = provider.parseWebhook(raw, signature);
  if (!event) {
    console.warn("Billing webhook rejected: bad or missing signature.");
    return new Response("Invalid signature", { status: 401 });
  }

  const fresh = await recordBillingEvent({
    providerEventId: event.id,
    type: event.type,
    payload: { subscriptionId: event.providerSubscriptionId, status: event.status },
  });
  if (!fresh) return Response.json({ ok: true, deduped: true });

  if (!event.providerSubscriptionId) return Response.json({ ok: true });

  const { status: mapped } = mapProviderStatus(event.status);

  // A workspace subscription is billed through the same gateway and arrives
  // through the same webhook, so it is resolved here before giving up.
  const org = await findOrgByProviderSubscriptionId(event.providerSubscriptionId);
  if (org) {
    await setOrgSubscriptionStatus(org.id, mapped, {
      ...(event.currentPeriodEnd ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
    });
    if (mapped === "active") {
      void track(EVENTS.SUBSCRIPTION_ACTIVATED, {
        props: { plan: org.planId, scope: "org", seats: org.seats },
      });
    } else if (mapped === "cancelled") {
      void track(EVENTS.SUBSCRIPTION_CANCELLED, { props: { plan: org.planId, scope: "org" } });
    }
    await recordBillingEvent({
      type: `applied.org.${event.type}`,
      payload: { orgId: org.id, status: mapped },
    });
    return Response.json({ ok: true });
  }

  const sub = await findByProviderSubscriptionId(event.providerSubscriptionId);
  if (!sub) {
    // Arrived before checkout finished writing, or belongs to another
    // environment sharing the gateway. Logged, not failed.
    console.warn("Billing webhook for unknown subscription:", event.providerSubscriptionId);
    return Response.json({ ok: true });
  }

  const status = mapped;
  await setSubscriptionStatus(sub.userId, status, {
    ...(event.currentPeriodEnd ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
    ...(event.type === "subscription.cancelled" ? { cancelAtPeriodEnd: true } : {}),
  });
  if (status === "active") {
    void track(EVENTS.SUBSCRIPTION_ACTIVATED, { userId: sub.userId, props: { plan: sub.planId } });
  } else if (status === "cancelled") {
    void track(EVENTS.SUBSCRIPTION_CANCELLED, { userId: sub.userId, props: { plan: sub.planId } });
  }
  await recordBillingEvent({
    userId: sub.userId,
    type: `applied.${event.type}`,
    payload: { status, currentPeriodEnd: event.currentPeriodEnd ?? null },
  });

  return Response.json({ ok: true });
}
