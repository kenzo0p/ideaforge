"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { PLANS, formatPrice, type PlanId } from "@/lib/billing/plans";
import { trackUpgradePromptAction } from "@/lib/analytics/track-actions";

// ---------------------------------------------------------------------------
// The moment someone is refused.
//
// A 402 rendered as red error text is a dead end: it tells you what you can't
// do and leaves you there. This is the only point in the product where someone
// is actively motivated to pay, so it shows what the plan *gives* — priced, with
// the upgrade one click away.
//
// Impressions and clicks are tracked separately. Without both, a drop-off can't
// be told apart from "no prompt was ever shown", and those need opposite fixes.
// ---------------------------------------------------------------------------

/** The three or four lines worth showing for the plan being offered. */
function highlights(planId: PlanId): string[] {
  const p = PLANS[planId];
  const out = [
    Number.isFinite(p.limits.projects)
      ? `${p.limits.projects} saved projects`
      : "Unlimited saved projects",
    `${p.limits.dailyRuns} copilot runs a day`,
  ];
  if (p.features.compare) out.push("Compare ideas side by side");
  if (p.features.collaboration) out.push(`${p.limits.collaboratorsPerProject} collaborators per project`);
  if (p.limits.watches > 1) out.push(`${p.limits.watches} watches, checked daily`);
  if (p.features.integrations) out.push("Send to Notion and Google Docs");
  return out.slice(0, 5);
}

export default function UpgradePrompt({
  reason,
  plan = "pro",
  limit,
  onDismiss,
  compact = false,
}: {
  /** What the server said, in the user's terms. */
  reason: string;
  plan?: PlanId;
  /** Which gate fired — recorded so the funnel can be split by cause. */
  limit: string;
  onDismiss?: () => void;
  /** Inline variant for tight spaces like the invite box. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const impression = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = PLANS[plan];

  useEffect(() => {
    // Counted once per gate: an effect that re-runs is still one thing seen.
    if (impression.current === limit) return;
    impression.current = limit;
    void trackUpgradePromptAction("shown", limit);
  }, [limit]);

  async function upgrade() {
    setBusy(true);
    setError(null);
    void trackUpgradePromptAction("clicked", limit);
    try {
      // Straight to checkout rather than via /pricing: they already know what
      // they want, and an extra page is an extra place to lose them.
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <div className="mt-2 rounded-lg border border-brand/40 bg-brand/5 p-3 text-sm">
        <p className="mb-2">{reason}</p>
        <button
          onClick={upgrade}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3 py-1.5 text-xs font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {target.name} · {formatPrice(target.pricePaise)}/mo
        </button>
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="my-4 rounded-2xl border border-brand/40 bg-brand/5 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{reason}</p>
          <p className="mt-0.5 text-xs text-muted">
            {target.name} is {formatPrice(target.pricePaise)}/month — cancel any time.
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-md p-1 text-muted transition hover:bg-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <ul className="mb-4 grid gap-1.5 sm:grid-cols-2">
        {highlights(plan).map((h) => (
          <li key={h} className="flex items-center gap-1.5 text-sm">
            <Check className="size-3.5 shrink-0 text-success" />
            {h}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={upgrade}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Upgrade to {target.name}
          <ArrowRight className="size-3.5" />
        </button>
        <a
          href="/pricing"
          className="text-xs text-muted underline transition hover:text-foreground"
        >
          Compare plans
        </a>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Pull a plan refusal out of a fetch response.
 *
 * Gates answer with 402 (feature or quota not on this plan) or 429 with an
 * `upgrade` flag (daily cap). Returning null for anything else keeps ordinary
 * failures out of the upgrade path — showing someone a price because the
 * network blipped is worse than showing nothing.
 */
export function parseLimitError(
  status: number,
  body: { error?: string; upgradeTo?: string; upgrade?: boolean; quota?: string },
  // Never "free": a refusal always has something to sell.
): { reason: string; plan: "pro" | "team"; limit: string } | null {
  const isPaywall = status === 402;
  const isQuota = status === 429 && body.upgrade === true;
  if (!isPaywall && !isQuota) return null;

  const plan = body.upgradeTo === "team" ? "team" : "pro";
  return {
    reason: body.error ?? "You've reached a limit on your current plan.",
    plan,
    limit: isQuota ? "daily_runs" : (body.quota ?? "feature"),
  };
}
