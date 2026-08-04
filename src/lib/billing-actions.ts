"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getSubscription, setSubscriptionStatus, recordBillingEvent } from "@/lib/db/subscriptions";
import { getBillingProvider } from "@/lib/billing/provider";
import { planFor } from "@/lib/billing/resolve";
import { membershipFor } from "@/lib/db/orgs";
import { listProjects } from "@/lib/db/projects";

/**
 * Everything the billing UI needs: plan, usage against limits, gateway mode.
 *
 * The plan shown here is the *resolved* one, so it matches what the gates
 * actually enforce. Reading the personal subscription alone would tell someone
 * on a workspace seat that they were on Free while the app happily let them use
 * Team features — the settings page and the enforcement layer must never
 * disagree about what you have.
 */
export async function billingStatusAction() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [sub, plan, membership] = await Promise.all([
    getSubscription(user.id),
    planFor(user.id),
    membershipFor(user.id),
  ]);
  const owned = (await listProjects(user.id)).filter((p) => p.isOwner).length;

  // Whether this plan comes from the workspace rather than a personal purchase
  // decides what the UI may offer: there is nothing here for them to cancel.
  const viaOrg = membership && plan.id === membership.org.planId && plan.id !== "free"
    ? membership.org.name
    : null;

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      pricePaise: plan.pricePaise,
      limits: {
        projects: Number.isFinite(plan.limits.projects) ? plan.limits.projects : null,
        dailyRuns: plan.limits.dailyRuns,
        collaboratorsPerProject: plan.limits.collaboratorsPerProject,
      },
    },
    viaOrg,
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    projectsUsed: owned,
    simulated: getBillingProvider().isMock,
  };
}

/**
 * Cancel at period end.
 *
 * Never revokes access immediately — the user paid for the period, and taking
 * it away the moment they cancel is what generates chargebacks.
 */
export async function cancelSubscriptionAction(): Promise<{ error?: string; ok?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const sub = await getSubscription(user.id);
  if (!sub || sub.planId === "free") return { error: "No paid plan to cancel." };

  try {
    if (sub.providerSubscriptionId && !getBillingProvider().isMock) {
      await getBillingProvider().cancelSubscription(sub.providerSubscriptionId);
    }
    await setSubscriptionStatus(user.id, "cancelled", { cancelAtPeriodEnd: true });
    await recordBillingEvent({
      userId: user.id,
      type: "subscription.cancel_requested",
      payload: { planId: sub.planId },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not cancel." };
  }
}
