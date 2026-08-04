import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingProvider } from "@/lib/billing/provider";
import { recordBillingEvent, upsertSubscription } from "@/lib/db/subscriptions";
import { membershipFor, setOrgPlan } from "@/lib/db/orgs";
import { publicUrl } from "@/lib/http/origin";
import type { PlanId } from "@/lib/billing/plans";

export const runtime = "nodejs";

/**
 * GET /api/billing/simulate?plan=pro — grant a plan without taking payment.
 *
 * Exists so the tier logic can be demonstrated and tested end to end without a
 * live merchant account. It is refused outright whenever a real gateway is
 * configured — otherwise it would be a free upgrade button in production.
 */
export async function GET(req: Request) {
  const provider = getBillingProvider();
  if (!provider.isMock) {
    return new Response("Not available: a real payment gateway is configured.", { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const params = new URL(req.url).searchParams;
  const plan = params.get("plan");
  if (plan !== "pro" && plan !== "team") {
    return new Response("Unknown plan", { status: 400 });
  }

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const wantsOrg = params.get("scope") === "org";
  const membership = wantsOrg ? await membershipFor(user.id) : null;
  if (wantsOrg && membership?.role !== "owner") {
    return new Response("Only a workspace owner can upgrade the workspace.", { status: 403 });
  }

  if (membership) {
    await setOrgPlan({
      orgId: membership.org.id,
      planId: plan as PlanId,
      status: "active",
      currentPeriodEnd: Date.now() + THIRTY_DAYS,
      providerSubscriptionId: `mock_org_${membership.org.id}`,
    });
  } else {
    await upsertSubscription({
      userId: user.id,
      planId: plan as PlanId,
      status: "active",
      currentPeriodEnd: Date.now() + THIRTY_DAYS,
      providerSubscriptionId: `mock_${user.id}`,
    });
  }
  // Same event the webhook records, so the revenue funnel has a last step in
  // mock mode too — otherwise it always reads as 0% converted.
  void track(EVENTS.SUBSCRIPTION_ACTIVATED, {
    userId: user.id,
    props: { plan, mock: true, scope: membership ? "org" : "user" },
  });
  await recordBillingEvent({
    userId: user.id,
    type: "subscription.simulated",
    payload: { planId: plan, orgId: membership?.org.id ?? null },
  });

  return Response.redirect(
    await publicUrl(membership ? `/org?billing=simulated-${plan}` : `/settings?billing=simulated-${plan}`),
    302,
  );
}
