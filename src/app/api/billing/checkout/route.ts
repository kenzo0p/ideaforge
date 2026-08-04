import { requireApiUser } from "@/lib/auth/api";
import { getBillingProvider } from "@/lib/billing/provider";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { upsertSubscription, recordBillingEvent } from "@/lib/db/subscriptions";
import { membershipFor, setOrgPlan } from "@/lib/db/orgs";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const runtime = "nodejs";

// POST /api/billing/checkout { plan: "pro" | "team", scope?: "user" | "org" }
//
// Starts an upgrade. The plan comes from a fixed table, never from a price sent
// by the client — otherwise anyone could POST their own amount.
//
// `scope: "org"` buys the workspace's plan rather than a personal one. It is a
// separate scope, not a separate endpoint, so that both paths share the same
// intent record and the same webhook. Charging an owner and then upgrading the
// wrong thing is the single worst bug this endpoint could have.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  let planId: PlanId;
  let scope: "user" | "org" = "user";
  try {
    const body = (await req.json()) as { plan?: string; scope?: string };
    if (body.plan !== "pro" && body.plan !== "team") {
      return Response.json({ error: "Unknown plan." }, { status: 400 });
    }
    planId = body.plan;
    if (body.scope === "org") scope = "org";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Resolved from the session, never from the request: an orgId in a body would
  // let anyone attach a subscription to someone else's workspace.
  const membership = scope === "org" ? await membershipFor(auth.id) : null;
  if (scope === "org" && membership?.role !== "owner") {
    return Response.json(
      { error: "Only a workspace owner can upgrade the workspace." },
      { status: 403 },
    );
  }

  const provider = getBillingProvider();
  try {
    const session = await provider.createSubscription({
      planId,
      userId: auth.id,
      email: auth.email,
      scope,
    });

    // Record the intent before the user leaves. `pending` grants nothing, but
    // it means a webhook arriving before the redirect completes has a row to
    // update rather than creating a half-formed one.
    if (membership) {
      await setOrgPlan({
        orgId: membership.org.id,
        planId,
        status: "pending",
        providerSubscriptionId: session.subscriptionId,
      });
    } else {
      await upsertSubscription({
        userId: auth.id,
        planId,
        status: "pending",
        providerSubscriptionId: session.subscriptionId,
      });
    }
    await recordBillingEvent({
      userId: auth.id,
      type: "checkout.started",
      payload: {
        planId,
        scope,
        orgId: membership?.org.id ?? null,
        provider: provider.id,
        amount: PLANS[planId].pricePaise,
      },
    });

    void track(EVENTS.CHECKOUT_STARTED, { userId: auth.id, props: { plan: planId, scope } });
    return Response.json(session);
  } catch (err) {
    console.error("Checkout failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
