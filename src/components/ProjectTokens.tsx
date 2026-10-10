import { Coins } from "lucide-react";
import { OPERATION_LABEL, type Operation, type UsageTotal } from "@/lib/db/tokens";

const fmt = (n: number) => n.toLocaleString();

/**
 * What this project has cost in tokens, and where it went.
 *
 * The breakdown is the useful half. A single total tells you a project was
 * expensive; the split tells you it was the research, which is the thing you
 * can do something about — re-run it less, or narrow the idea before you do.
 *
 * Bars are drawn against the largest operation rather than the total, so the
 * smallest row is still visible. A bar scaled to the total makes everything
 * except the biggest item a sliver, which is a chart that only communicates
 * its own maximum.
 */
export default function ProjectTokens({
  total,
  byOperation,
}: {
  total: UsageTotal;
  byOperation: Array<{ operation: Operation; total: UsageTotal }>;
}) {
  if (total.runs === 0) return null;
  const peak = Math.max(...byOperation.map((o) => o.total.totalTokens), 1);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Coins className="size-4 self-center text-brand" />
        <h2 className="text-sm font-semibold">Tokens used</h2>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {fmt(total.totalTokens)}
        </span>
        <span className="text-xs text-muted">
          across {total.runs} {total.runs === 1 ? "run" : "runs"}
          {total.calls !== total.runs && ` · ${total.calls} model calls`}
          {total.estimated && " · includes estimates"}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-muted">
        {fmt(total.inputTokens)} read · {fmt(total.outputTokens)} written.
        {total.estimated &&
          " Runs made in demo mode have no real token count, so their share is calculated from text length."}
      </p>

      <ul className="mt-3 space-y-2">
        {byOperation.map(({ operation, total: t }) => (
          <li key={operation}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{OPERATION_LABEL[operation]}</span>
              <span className="tabular-nums text-muted">
                {fmt(t.totalTokens)}
                <span className="ml-1.5 opacity-70">
                  ({t.runs} {t.runs === 1 ? "run" : "runs"})
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-brand-solid"
                style={{ width: `${Math.max(2, (t.totalTokens / peak) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
