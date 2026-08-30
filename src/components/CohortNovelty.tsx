import Link from "next/link";
import { AlertTriangle, CopyCheck, Layers } from "lucide-react";
import type { CohortNovelty as Report, IdeaCluster } from "@/lib/db/similar";

function pct(score: number): number {
  return Math.round(score * 100);
}

function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Overlapping ideas across a whole workspace.
 *
 * The deliberate restraint here is in the wording. The system compares vectors;
 * it does not know whether two students collaborated, read the same paper, or
 * were handed the same brief by the same guide. Every phrase on this page is
 * therefore about *resemblance* and about what a person should go and look at
 * — never "duplicate", never "copied". A tool that hands a mentor a plagiarism
 * verdict it cannot support has done something worse than nothing.
 */
export default function CohortNovelty({ report }: { report: Report }) {
  const { clusters, indexed, clustered, model, truncated } = report;
  const degraded = model !== "minilm";

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Layers className="size-4 text-brand" />
        Overlapping ideas
      </h2>
      <p className="mb-4 max-w-prose text-xs text-muted">
        Every idea in this workspace compared against every other. Ideas that resemble each
        other closely are grouped below so you can read them side by side — this is a
        prompt to look, not a finding of duplication.
      </p>

      {degraded && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This workspace is running the fallback text model, which cannot tell a rewording
            apart from an unrelated idea. Treat the groups below as unreliable.
          </span>
        </p>
      )}

      {indexed < 2 ? (
        <p className="text-sm text-muted">
          Not enough ideas to compare yet — there {indexed === 1 ? "is one" : "are none"} in
          this workspace.
        </p>
      ) : clusters.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CopyCheck className="size-4 shrink-0" />
          All {indexed} ideas in this workspace are distinct from one another.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            <span className="font-semibold tabular-nums">{clustered}</span> of{" "}
            <span className="tabular-nums">{indexed}</span> ideas fall into{" "}
            <span className="font-semibold tabular-nums">{clusters.length}</span>{" "}
            {clusters.length === 1 ? "group" : "groups"} of lookalikes.
          </p>
          <ul className="space-y-3">
            {clusters.map((c) => (
              <Cluster key={c.id} cluster={c} />
            ))}
          </ul>
        </>
      )}

      {truncated && (
        <p className="mt-3 text-[11px] text-muted">
          Only the {indexed} most recently updated ideas were compared. Older ones are not
          included in the groups above.
        </p>
      )}
    </section>
  );
}

function Cluster({ cluster }: { cluster: IdeaCluster }) {
  // Above this, two ideas are near-paraphrases of each other. Below it they are
  // more likely to be the same domain than the same project, and the wording
  // says so rather than leaving the reader to infer it from a percentage.
  const veryClose = cluster.peak >= 0.85;

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
            veryClose
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border text-muted"
          }`}
        >
          {pct(cluster.peak)}% alike
        </span>
        <span className="text-[11px] text-muted">
          {cluster.members.length} ideas ·{" "}
          {veryClose ? "near-identical wording" : "same problem space"}
        </span>
      </div>

      <ul className="space-y-2">
        {cluster.members.map((m) => (
          <li key={m.projectId} className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                href={`/org/projects/${m.projectId}`}
                className="font-medium hover:text-brand"
              >
                {m.title}
              </Link>
              {m.ownerUsername && (
                <Link
                  href={`/org/members/${m.ownerUsername}`}
                  className="text-[11px] text-muted hover:text-foreground"
                >
                  {m.ownerName ?? `@${m.ownerUsername}`}
                </Link>
              )}
              {/* Who proposed it first is the fact a mentor reaches for next,
                  and it is a fact rather than an inference. */}
              <span className="text-[11px] text-muted">started {day(m.createdAt)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{m.idea}</p>
          </li>
        ))}
      </ul>
    </li>
  );
}
