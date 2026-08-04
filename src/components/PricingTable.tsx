"use client";

import { useState } from "react";
import { Check, Loader2, Minus, Sparkles } from "lucide-react";
import { PLANS, formatLimit, formatPrice, type PlanId } from "@/lib/billing/plans";

const ROWS: { label: string; value: (p: (typeof PLANS)[PlanId]) => string | boolean }[] = [
  { label: "Saved projects", value: (p) => formatLimit(p.limits.projects) },
  { label: "Copilot runs per day", value: (p) => String(p.limits.dailyRuns) },
  { label: "Validation, DeepSearch, build plan", value: () => true },
  { label: "Deck review", value: (p) => p.features.deckReview },
  { label: "Exports (PDF, Word, PowerPoint, Markdown)", value: () => true },
  { label: "Compare ideas side by side", value: (p) => p.features.compare },
  { label: "Collaborators per project", value: (p) => formatLimit(p.limits.collaboratorsPerProject) },
  { label: "Telegram agent + reminders", value: (p) => p.features.agent },
  { label: "Send to Notion / Google Docs", value: (p) => p.features.integrations },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto size-4 text-success" />;
  if (value === false) return <Minus className="mx-auto size-4 text-muted/50" />;
  return <span className="text-sm tabular-nums">{value}</span>;
}

/**
 * Pricing table.
 *
 * Reads the same PLANS table the server enforces, so what's advertised and
 * what's granted cannot drift apart.
 */
export default function PricingTable({
  currentPlan,
  signedIn,
  simulated,
}: {
  currentPlan: PlanId;
  signedIn: boolean;
  simulated: boolean;
}) {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order: PlanId[] = ["free", "pro", "team"];

  async function upgrade(plan: PlanId) {
    if (!signedIn) {
      window.location.assign(`/sign-in?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    setBusy(plan);
    setError(null);
    try {
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
      setBusy(null);
    }
  }

  return (
    <div>
      {simulated && (
        <p className="mb-5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          No payment gateway is configured, so upgrades here are simulated — no money moves.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {order.map((id) => {
          const p = PLANS[id];
          const current = currentPlan === id;
          const featured = id === "pro";
          return (
            <div
              key={id}
              className={`relative rounded-2xl border bg-card p-5 ${
                featured ? "border-brand shadow-md" : "border-border"
              }`}
            >
              {featured && (
                <span className="absolute -top-2.5 left-5 rounded-full bg-brand-solid px-2.5 py-0.5 text-[11px] font-semibold text-on-brand">
                  Most popular
                </span>
              )}
              <h2 className="text-sm font-semibold">{p.name}</h2>
              <p className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-bold">{formatPrice(p.pricePaise)}</span>
                {p.pricePaise > 0 && <span className="text-xs text-muted">/month</span>}
              </p>
              <p className="mt-1.5 min-h-[2.5rem] text-xs text-muted">{p.tagline}</p>

              {current ? (
                <span className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-4 py-2 text-sm font-medium text-success">
                  <Check className="size-4" /> Current plan
                </span>
              ) : id === "free" ? (
                <span className="mt-4 block w-full rounded-lg border border-border px-4 py-2 text-center text-sm text-muted">
                  Always free
                </span>
              ) : (
                <button
                  onClick={() => upgrade(id)}
                  disabled={busy !== null}
                  className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                    featured
                      ? "bg-brand-solid text-on-brand hover:opacity-90"
                      : "border border-border-strong hover:bg-hover"
                  }`}
                >
                  {busy === id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Upgrade to {p.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted">What you get</th>
              {order.map((id) => (
                <th key={id} className="px-4 py-3 text-center text-xs font-semibold">
                  {PLANS[id].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-left">{row.label}</td>
                {order.map((id) => (
                  <td key={id} className="px-4 py-2.5 text-center">
                    <Cell value={row.value(PLANS[id])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
