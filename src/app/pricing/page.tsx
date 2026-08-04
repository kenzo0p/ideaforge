import { CreditCard } from "lucide-react";
import PricingTable from "@/components/PricingTable";
import { getCurrentUser } from "@/lib/auth/session";
import { currentPlan } from "@/lib/billing/entitlements";
import { getBillingProvider } from "@/lib/billing/provider";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await getCurrentUser();
  const plan = await currentPlan();
  // Views are what connect "hit a limit" to "started checkout".
  void track(EVENTS.PRICING_VIEWED, { userId: user?.id, props: { plan: plan.id } });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <CreditCard className="size-6 text-brand" />
        Plans
      </h1>
      <p className="mb-8 text-sm text-muted">
        Free is a real tier, not a trial — enough to validate an idea end to end.
      </p>

      <PricingTable
        currentPlan={plan.id}
        signedIn={!!user}
        simulated={getBillingProvider().isMock}
      />
    </main>
  );
}
