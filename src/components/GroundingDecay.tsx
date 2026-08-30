import { AlertTriangle, FileWarning, PencilLine, TrendingDown } from "lucide-react";
import { groundingPercent } from "@/lib/verify/score";
import type { GroundingPoint, RottedSource } from "@/lib/db/grounding";
import type { SourceDrift } from "@/lib/verify/evidence";

function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * What has happened to this brief's evidence since it was written.
 *
 * Renders nothing until there is something to say. A brief checked once has no
 * trend, and inventing one — "0 sources lost!" — would be noise dressed as
 * information; the absence of this block is itself accurate.
 *
 * When the score has *improved* it says so too. A one-directional decay
 * indicator would be a rhetorical device rather than a measurement, and a site
 * that was down last month and is up this month is a real thing that happened.
 */
export default function GroundingDecay({
  history,
  rotted,
  drift = [],
}: {
  history: GroundingPoint[];
  rotted: RottedSource[];
  drift?: SourceDrift[];
}) {
  // A page that changed in ways nothing relied on is not news, so only drift
  // with a consequence counts towards showing this block at all.
  const notable = drift.filter((d) => d.lostClaims.length > 0 || d.kind === "rewritten");
  if (history.length < 2 && rotted.length === 0 && notable.length === 0) return null;

  const first = history[0];
  const latest = history[history.length - 1];
  const delta = groundingPercent(latest.groundingScore) - groundingPercent(first.groundingScore);
  const lost = first.verified - latest.verified;

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <TrendingDown className={`size-3.5 ${delta < 0 ? "text-warning" : "text-muted"}`} />
        Since this brief was written
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        First checked {day(first.checkedAt)} at{" "}
        <span className="tabular-nums font-medium">{groundingPercent(first.groundingScore)}%</span>{" "}
        ({first.verified}/{first.total}). Re-checked {history.length - 1}{" "}
        {history.length === 2 ? "time" : "times"} since, most recently {day(latest.checkedAt)} at{" "}
        <span className="tabular-nums font-medium">{groundingPercent(latest.groundingScore)}%</span>{" "}
        ({latest.verified}/{latest.total}).{" "}
        {delta < 0 && (
          <span className="text-warning">
            {lost > 0
              ? `${lost} ${lost === 1 ? "source has" : "sources have"} stopped resolving.`
              : `Down ${Math.abs(delta)} points.`}
          </span>
        )}
        {delta > 0 && <span className="text-success">Up {delta} points — a source came back.</span>}
        {delta === 0 && rotted.length === 0 && <span>Unchanged.</span>}
      </p>

      {notable.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {notable.map((d) => (
            <li key={d.citationId} className="flex items-start gap-1.5 text-[11px]">
              {d.lostClaims.length > 0 ? (
                <FileWarning className="mt-0.5 size-3 shrink-0 text-danger" />
              ) : (
                <PencilLine className="mt-0.5 size-3 shrink-0 text-warning" />
              )}
              <span className="min-w-0">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium hover:text-brand"
                >
                  [{d.citationId}]
                </a>{" "}
                {d.lostClaims.length > 0 ? (
                  <span className="text-danger">
                    still online, but no longer contains the passage{" "}
                    {d.lostClaims.length === 1 ? "a claim was" : `${d.lostClaims.length} claims were`}{" "}
                    based on
                  </span>
                ) : (
                  <span className="text-warning">
                    substantially rewritten
                    {d.similarity !== null && (
                      <span className="text-muted">
                        {" "}
                        ({Math.round(d.similarity * 100)}% of the page survives)
                      </span>
                    )}
                  </span>
                )}
                {d.lostClaims.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {d.lostClaims.map((c) => (
                      <li key={c.index} className="text-muted">
                        — “{c.text.length > 110 ? `${c.text.slice(0, 107)}…` : c.text}”
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {rotted.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rotted.map((r) => (
            <li key={r.url} className="flex items-start gap-1.5 text-[11px] text-muted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
              <span className="min-w-0">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium hover:text-brand"
                >
                  [{r.id}] {r.title}
                </a>{" "}
                — verified when written, now{" "}
                <span className="text-warning">{r.now}</span> (noticed {day(r.noticedAt)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
