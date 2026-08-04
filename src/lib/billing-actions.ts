"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { getSubscription, setSubscriptionStatus, recordBillingEvent } from "@/lib/db/subscriptions";
import { getBillingProvider } from "@/lib/billing/provider";
import { effectivePlan } from "@/lib/billing/plans";
import { listProjects } from "@/lib/db/projects";

/** Everything the billing UI needs: plan, usage against limits, gateway mode. */
export async function billingStatusAction() {
  const user = await getCurrentUser();
  if (!user) return null;

  const sub = await getSubscription(user.id);
  const plan = effectivePlan(sub);
  const owned = (await listProjects(user.id)).filter((p) => p.isOwner).length;

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
