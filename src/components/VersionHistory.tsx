"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  compareWithCurrentAction,
  listVersionsAction,
  restoreVersionAction,
  type VersionComparison,
} from "@/lib/version-actions";
import { timeAgo } from "@/lib/format";
import type { VersionSummary } from "@/lib/db/versions";

const LABEL: Record<string, string> = {
  title: "title",
  validation: "validation",
  research: "research",
  plan: "plan",
};

/**
 * The project's history.
 *
 * Loaded on demand rather than with the page: most visits never open it, and
 * the timeline query would otherwise be on the critical path of every project
 * view for a feature used occasionally.
 */
export default function VersionHistory({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || versions) return;
    let cancelled = false;
    void listVersionsAction(projectId).then((rows) => {
      if (!cancelled) setVersions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, versions, projectId]);

  function compare(versionId: string) {
    setError(null);
    setSelected(versionId);
    setComparison(null);
    start(async () => {
      const res = await compareWithCurrentAction(projectId, versionId);
      if ("error" in res) return setError(res.error);
      setComparison(res);
    });
  }

  function restore(versionId: string) {
    setError(null);
    start(async () => {
      const res = await restoreVersionAction(projectId, versionId);
      if (res.error) return setError(res.error);
      // The restore is itself snapshotted, so the timeline gained an entry.
      setVersions(null);
      setComparison(null);
      setSelected(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <History className="size-4 text-brand" />
        <span className="text-sm font-semibold">History</span>
        <span className="ml-auto text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-4">
          {versions === null ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted">
              No earlier versions yet. One is kept each time you regenerate something.
            </p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={`rounded-lg border p-3 transition ${
                    selected === v.id ? "border-brand/50 bg-brand/5" : "border-border bg-surface"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{timeAgo(v.createdAt)}</span>
                    <span className="text-xs text-muted">
                      changed {v.changed.map((k) => LABEL[k] ?? k).join(", ") || "nothing"}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button
                        onClick={() => compare(v.id)}
                        disabled={pending}
                        className="text-xs font-medium text-brand underline disabled:opacity-50"
                      >
                        Compare
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => restore(v.id)}
                          disabled={pending}
                          className="inline-flex items-center gap-1 text-xs font-medium text-muted underline transition hover:text-foreground disabled:opacity-50"
                        >
                          <RotateCcw className="size-3" />
                          Restore
                        </button>
                      )}
                    </span>
                  </div>

                  {selected === v.id && comparison && (
                    <Comparison comparison={comparison} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** What the current project has that this version didn't, and vice versa. */
function Comparison({ comparison }: { comparison: VersionComparison }) {
  const { validation, plan, research } = comparison;
  const nothing =
    (!validation || (!validation.added.length && !validation.removed.length)) &&
    (!plan || (!plan.milestones.added.length && !plan.milestones.removed.length && !plan.techStack.added.length && !plan.techStack.removed.length)) &&
    (!research || (!research.citationDelta && !research.solutionDelta && !research.gapDelta && !research.newSources.length));

  if (nothing) {
    return <p className="mt-3 text-xs text-muted">Nothing differs from the current version.</p>;
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <p className="text-muted">Compared with the project as it is now:</p>

      {validation && (validation.added.length > 0 || validation.removed.length > 0) && (
        <div>
          <p className="mb-1 font-medium">Validation</p>
          <p className="text-muted">
            {validation.added.length} line(s) added, {validation.removed.length} removed,{" "}
            {validation.unchanged} unchanged
          </p>
          <ul className="mt-1 space-y-0.5 font-mono">
            {validation.added.slice(0, 4).map((line, i) => (
              <li key={`a${i}`} className="flex gap-1 text-success">
                <Plus className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-2">{line}</span>
              </li>
            ))}
            {validation.removed.slice(0, 4).map((line, i) => (
              <li key={`r${i}`} className="flex gap-1 text-danger">
                <Minus className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-2">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && (plan.milestones.added.length > 0 || plan.milestones.removed.length > 0 || plan.techStack.added.length > 0) && (
        <div>
          <p className="mb-1 font-medium">Plan</p>
          {plan.milestoneDelta !== 0 && (
            <p className="text-muted">
              {plan.milestoneDelta > 0 ? "+" : ""}
              {plan.milestoneDelta} milestone(s)
            </p>
          )}
          {plan.milestones.added.slice(0, 3).map((m) => (
            <p key={m} className="flex gap-1 text-success">
              <Plus className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-1">{m}</span>
            </p>
          ))}
          {plan.milestones.removed.slice(0, 3).map((m) => (
            <p key={m} className="flex gap-1 text-danger">
              <Minus className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-1">{m}</span>
            </p>
          ))}
          {plan.techStack.added.slice(0, 4).map((t) => (
            <p key={t} className="flex gap-1 text-success">
              <Plus className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-1">{t}</span>
            </p>
          ))}
        </div>
      )}

      {research && (
        <div>
          <p className="mb-1 font-medium">Research</p>
          <p className="text-muted">
            {research.citationDelta >= 0 ? "+" : ""}
            {research.citationDelta} citations · {research.solutionDelta >= 0 ? "+" : ""}
            {research.solutionDelta} existing solutions · {research.gapDelta >= 0 ? "+" : ""}
            {research.gapDelta} gaps
          </p>
          {research.newSources.length > 0 && (
            <p className="mt-0.5 text-muted">
              New sources: {research.newSources.slice(0, 5).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
