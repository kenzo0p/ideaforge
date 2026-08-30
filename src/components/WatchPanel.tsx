"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Database,
  ExternalLink,
  FileText,
  GitBranch,
  Newspaper,
  Radar,
  Sparkles,
} from "lucide-react";
import {
  markFindingsSeenAction,
  setWatchCadenceAction,
  startWatchAction,
  stopWatchAction,
} from "@/lib/watch-actions";
import { timeAgo } from "@/lib/format";
import type { Finding, Watch, WatchCadence } from "@/lib/db/watches";
import UpgradePrompt from "@/components/UpgradePrompt";

const KIND_ICON = {
  paper: FileText,
  repo: GitBranch,
  dataset: Database,
  news: Newspaper,
  other: Newspaper,
} as const;

/**
 * Standing monitor on a project's problem space.
 *
 * The pitch is on the empty state, not buried in settings: someone who has just
 * finished research is exactly the person who wants to know when that research
 * goes stale.
 */
export default function WatchPanel({
  projectId,
  watch,
  findings,
}: {
  projectId: string;
  watch: Watch | null;
  findings: Finding[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  // Opening the panel is the read receipt — clears the badge for next time.
  useEffect(() => {
    if (watch && watch.unseenCount > 0) {
      const t = setTimeout(() => void markFindingsSeenAction(projectId), 1200);
      return () => clearTimeout(t);
    }
  }, [watch, projectId]);

  function run(fn: () => Promise<{ error?: string; upgradeTo?: string }>) {
    setError(null);
    setUpgrade(null);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        setUpgrade(res.upgradeTo ?? null);
      }
    });
  }

  if (!watch) {
    return (
      <div className="mb-6 rounded-2xl border border-dashed border-border bg-card p-5">
        <div className="mb-2 flex items-center gap-2">
          <Radar className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">Watch this space</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-muted">
          Research goes stale. Turn this on and Scrutan keeps searching in the background —
          new papers, competing repos, funding news — and tells you only what it hasn&apos;t
          shown you before.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => run(() => startWatchAction(projectId, "weekly"))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            <Radar className="size-3.5" /> {pending ? "Starting…" : "Watch weekly"}
          </button>
          <button
            onClick={() => run(() => startWatchAction(projectId, "daily"))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
          >
            Watch daily
          </button>
        </div>
        {error && upgrade && (
          <UpgradePrompt
            reason={error}
            plan={upgrade as "pro" | "team"}
            limit="watches"
            compact
          />
        )}
        {error && !upgrade && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Radar className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Watching this space</h2>
        {watch.unseenCount > 0 && (
          <span className="rounded-full bg-brand-solid px-2 py-0.5 text-[11px] font-semibold text-on-brand">
            {watch.unseenCount} new
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          {watch.lastRunAt ? `Checked ${timeAgo(watch.lastRunAt)}` : "First check due shortly"}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["weekly", "daily"] as WatchCadence[]).map((c) => (
          <button
            key={c}
            onClick={() => run(() => setWatchCadenceAction(projectId, c))}
            disabled={pending}
            className={`rounded-full px-3 py-1 text-xs transition disabled:opacity-50 ${
              watch.cadence === c
                ? "bg-brand-solid text-on-brand"
                : "border border-border text-muted hover:bg-hover"
            }`}
          >
            {c === "weekly" ? "Weekly" : "Daily"}
          </button>
        ))}
        <button
          onClick={() => run(() => stopWatchAction(projectId))}
          disabled={pending}
          className="ml-auto text-xs text-muted underline transition hover:text-danger disabled:opacity-50"
        >
          Stop watching
        </button>
      </div>

      {error && upgrade && (
        <UpgradePrompt
          reason={error}
          plan={upgrade as "pro" | "team"}
          limit="watch_cadence"
          compact
        />
      )}
      {error && !upgrade && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}

      {findings.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
          Nothing new yet. You&apos;ll see anything that appears here, and only once.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => {
            const Icon = KIND_ICON[f.kind] ?? Newspaper;
            return (
              <li
                key={f.id}
                className={`rounded-lg border p-3 transition ${
                  f.seen ? "border-border bg-surface" : "border-brand/40 bg-brand/5"
                }`}
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2"
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-1.5">
                      <span className="text-sm font-medium group-hover:text-brand">
                        {f.title}
                      </span>
                      {!f.seen && <Sparkles className="mt-0.5 size-3 shrink-0 text-brand" />}
                    </span>
                    {f.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                        {f.snippet}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted">
                      {f.source} · {timeAgo(f.foundAt)}
                    </span>
                  </span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
