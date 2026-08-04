import { notFound } from "next/navigation";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { isAdmin } from "@/lib/analytics/admin";
import {
  activationFunnel,
  dailyActiveUsers,
  eventTotals,
  limitsHit,
  revenueFunnel,
  weeklyActivation,
  type FunnelStep,
} from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A funnel step, with the drop-off called out rather than left to arithmetic. */
function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.users || 1;
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const width = Math.max(2, (s.users / top) * 100);
        const dropped =
          s.conversionFromPrevious !== null && s.conversionFromPrevious < 0.5 && s.users > 0;
        return (
          <li key={s.event}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums text-muted">
                {s.users}
                {s.conversionFromPrevious !== null && (
                  <span className={dropped ? "ml-2 text-danger" : "ml-2 text-muted"}>
                    {pct(s.conversionFromPrevious)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface">
              <div
                className={`h-2 rounded-full ${dropped ? "bg-danger" : "bg-brand-solid"}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

export default async function AnalyticsPage() {
  // 404 rather than 403: an admin surface shouldn't confirm it exists.
  if (!(await isAdmin())) notFound();

  const [activation, revenue, limits, dau, totals, weekly] = await Promise.all([
    activationFunnel(30),
    revenueFunnel(30),
    limitsHit(30),
    dailyActiveUsers(14),
    eventTotals(30),
    weeklyActivation(EVENTS.RESEARCH_RUN, 6),
  ]);

  const peakDau = Math.max(1, ...dau.map((d) => d.users));

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <BarChart3 className="size-6 text-brand" />
        Analytics
      </h1>
      <p className="mb-8 text-sm text-muted">
        Last 30 days. Counts are distinct users, not events — one person validating ten ideas is
        one activated user.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Activation funnel"
          hint="Where people stop. A red bar is losing more than half the previous step."
        >
          <Funnel steps={activation} />
        </Card>

        <Card title="Revenue funnel" hint="Limit → pricing → checkout → paid.">
          <Funnel steps={revenue} />
        </Card>

        <Card title="Limits people hit" hint="What to price, and what to raise.">
          {limits.length === 0 ? (
            <p className="text-sm text-muted">Nobody has hit a limit yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {limits.map((l) => (
                <li key={l.limit} className="flex justify-between text-sm">
                  <span className="font-mono text-xs">{l.limit}</span>
                  <span className="tabular-nums text-muted">{l.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Daily active users" hint="Last 14 days.">
          {dau.length === 0 ? (
            <p className="text-sm text-muted">No activity recorded yet.</p>
          ) : (
            <div className="flex h-24 items-end gap-1">
              {dau.map((d) => (
                <div key={d.day} className="flex-1" title={`${d.day}: ${d.users}`}>
                  <div
                    className="rounded-t bg-brand-solid"
                    style={{ height: `${(d.users / peakDau) * 100}%`, minHeight: 2 }}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Weekly activation"
          hint="Share of each week's signups that ran DeepSearch — is the product getting better, or just busier?"
        >
          {weekly.length === 0 ? (
            <p className="text-sm text-muted">Not enough history yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {weekly.map((w) => {
                const rate = w.signups > 0 ? w.activated / w.signups : 0;
                return (
                  <li key={w.week} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted">{w.week}</span>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {w.activated}/{w.signups}
                      {rate >= 0.5 ? (
                        <TrendingUp className="size-3.5 text-success" />
                      ) : (
                        <TrendingDown className="size-3.5 text-warning" />
                      )}
                      <span className="w-10 text-right text-muted">{pct(rate)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="All events" hint="Anything at zero is either unused or uninstrumented.">
          {totals.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {totals.map((t) => (
                <li key={t.name} className="flex justify-between text-sm">
                  <span className="font-mono text-xs">{t.name}</span>
                  <span className="tabular-nums text-muted">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
