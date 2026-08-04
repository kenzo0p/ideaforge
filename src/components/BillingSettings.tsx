"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CreditCard } from "lucide-react";
import { cancelSubscriptionAction } from "@/lib/billing-actions";
import { formatPrice } from "@/lib/billing/plans";

interface Status {
  plan: { id: string; name: string; pricePaise: number; limits: { projects: number | null; dailyRuns: number } };
  /** Workspace name when the plan comes from a seat rather than a purchase. */
  viaOrg: string | null;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  projectsUsed: number;
  simulated: boolean;
}

/** Current plan, usage against its limits, and cancellation. */
export default function BillingSettings({ status }: { status: Status }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const paid = status.plan.id !== "free";
  // A seat isn't theirs to cancel or change — the workspace owner holds it.
  const ownsIt = paid && !status.viaOrg;
  const renews = status.currentPeriodEnd
    ? new Date(status.currentPeriodEnd).toLocaleDateString()
    : null;

  const projectLimit = status.plan.limits.projects;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-semibold text-brand">
          {status.plan.name}
        </span>
        {status.viaOrg ? (
          <span className="text-sm text-muted">via {status.viaOrg}</span>
        ) : (
          paid && (
            <span className="text-sm text-muted">
              {formatPrice(status.plan.pricePaise)}/month
              {renews && (status.cancelAtPeriodEnd ? ` · ends ${renews}` : ` · renews ${renews}`)}
            </span>
          )
        )}
        {status.simulated && ownsIt && (
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
            Simulated
          </span>
        )}
      </div>

      {status.status === "past_due" && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          A payment didn&apos;t go through. Your plan still works — update your payment method to
          keep it that way.
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-muted">Projects</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">
            {status.projectsUsed}
            {projectLimit === null ? " · unlimited" : ` / ${projectLimit}`}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-muted">Copilot runs per day</dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">{status.plan.limits.dailyRuns}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
        >
          <CreditCard className="size-4" />
          {ownsIt ? "Change plan" : paid ? "See plans" : "Upgrade"}
          <ArrowUpRight className="size-3.5" />
        </Link>

        {ownsIt && !status.cancelAtPeriodEnd && (
          <button
            onClick={() =>
              start(async () => {
                const res = await cancelSubscriptionAction();
                if (res.error) setError(res.error);
              })
            }
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
          >
            Cancel plan
          </button>
        )}
      </div>

      {ownsIt && status.cancelAtPeriodEnd && renews && (
        <p className="text-xs text-muted">
          Cancelled — you keep {status.plan.name} until {renews}, then move to Free.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
