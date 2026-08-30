"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2, Users } from "lucide-react";
import { similarIdeasAction } from "@/lib/research-actions";
import { timeAgo } from "@/lib/format";
import type { SimilarIdea } from "@/lib/db/similar";

/**
 * "Has someone already done this?"
 *
 * Shown at the moment the idea is entered, not after the work is done — the
 * whole value is arriving before the effort is spent. Silent when there is
 * nothing to say, because a panel that says "no matches" on every idea is a
 * panel people learn to scroll past.
 */
export default function SimilarIdeas({
  text,
  excludeProjectId,
}: {
  text: string;
  excludeProjectId?: string;
}) {
  const [results, setResults] = useState<SimilarIdea[] | null>(null);
  const [scope, setScope] = useState<"workspace" | "personal">("personal");
  const [corpus, setCorpus] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Every state change happens inside the timer rather than in the effect
    // body. Setting state synchronously during an effect forces React to
    // re-render before paint, which the lint rule exists to prevent — and here
    // it would also flash the spinner on every keystroke.
    const t = setTimeout(() => {
      const clean = text.trim();
      if (clean.length < 12) {
        setResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      void similarIdeasAction(clean, excludeProjectId)
        .then((res) => {
          if (cancelled) return;
          setResults(res.results);
          setScope(res.scope);
          setCorpus(res.corpusSize);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, excludeProjectId]);

  if (loading && !results) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3 animate-spin" /> Checking for similar work…
      </p>
    );
  }

  if (!results || results.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Copy className="size-4 text-warning" />
        {results.length} similar {results.length === 1 ? "idea has" : "ideas have"} been proposed
        {scope === "workspace" ? " in your workspace" : " by you"}
      </h3>
      <p className="mt-1 text-xs text-muted">
        Compared against {corpus} indexed {corpus === 1 ? "idea" : "ideas"}. Read them before you
        commit — overlapping with existing work is worth knowing now, not at the review.
      </p>

      <ul className="mt-3 space-y-2">
        {results.map((r) => (
          <li key={r.projectId} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <Link
                href={`/projects/${r.projectId}`}
                className="text-sm font-medium hover:text-brand"
              >
                {r.title}
              </Link>
              <span
                className="rounded-full border border-border px-1.5 py-0.5 text-[10px] tabular-nums text-muted"
                title="Cosine similarity between the two ideas"
              >
                {Math.round(r.score * 100)}% similar
              </span>
              <span className="ml-auto text-[11px] text-muted">{timeAgo(r.createdAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{r.idea}</p>
            {r.ownerUsername && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                <Users className="size-3" />
                {r.ownerName ?? `@${r.ownerUsername}`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
