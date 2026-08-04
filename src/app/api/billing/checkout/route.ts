import { requireApiUser } from "@/lib/auth/api";
import { getBillingProvider } from "@/lib/billing/provider";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { upsertSubscription, recordBillingEvent } from "@/lib/db/subscriptions";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const runtime = "nodejs";

// POST /api/billing/checkout { plan: "pro" | "team" }
//
// Starts an upgrade. The plan comes from a fixed table, never from a price sent
// by the client — otherwise anyone could POST their own amount.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  let planId: PlanId;
  try {
    const body = (await req.json()) as { plan?: string };
    if (body.plan !== "pro" && body.plan !== "team") {
      return Response.json({ error: "Unknown plan." }, { status: 400 });
    }
    planId = body.plan;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const provider = getBillingProvider();
  try {
    const session = await provider.createSubscription({
      planId,
      userId: auth.id,
      email: auth.email,
    });

    // Record the intent before the user leaves. `pending` grants nothing, but
    // it means a webhook arriving before the redirect completes has a row to
    // update rather than creating a half-formed one.
    await upsertSubscription({
      userId: auth.id,
      planId,
      status: "pending",
      providerSubscriptionId: session.subscriptionId,
    });
    await recordBillingEvent({
      userId: auth.id,
      type: "checkout.started",
      payload: { planId, provider: provider.id, amount: PLANS[planId].pricePaise },
    });

    void track(EVENTS.CHECKOUT_STARTED, { userId: auth.id, props: { plan: planId } });
    return Response.json(session);
  } catch (err) {
    console.error("Checkout failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
