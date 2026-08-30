"use client";

import { useState } from "react";
import { ArrowRight, ExternalLink, Loader2, Plus, Scale, Trophy, X } from "lucide-react";
import { USAGE_EVENT } from "@/components/UsageMeter";
import UpgradePrompt, { parseLimitError } from "@/components/UpgradePrompt";
import type { IdeaComparison, IdeaScores, RankedIdea } from "@/lib/pipeline/types";

const MAX_IDEAS = 3;
const AXES: { key: keyof IdeaScores; label: string; hint: string }[] = [
  { key: "severity", label: "Severity", hint: "How badly it hurts" },
  { key: "reach", label: "Reach", hint: "How many people" },
  { key: "feasibility", label: "Feasibility", hint: "Can you ship it" },
  { key: "differentiation", label: "Differentiation", hint: "Room left in the space" },
];

const EXAMPLES = [
  "A campus tool that matches students to research labs by interest",
  "An app that helps first-gen students navigate university bureaucracy",
];

type Status = "idle" | "loading" | "done" | "error";

/** 1–10 score as a bar, so a column can be read at a glance rather than parsed. */
function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-surface">
        <div
          className="h-1.5 rounded-full bg-brand-solid transition-all"
          style={{ width: `${value * 10}%` }}
        />
      </div>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{value}</span>
    </div>
  );
}

function IdeaColumn({ item, isWinner }: { item: RankedIdea; isWinner: boolean }) {
  return (
    <div
      className={`flex flex-col rounded-xl border p-4 ${
        isWinner ? "border-brand bg-brand/5" : "border-border bg-card"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {isWinner && <Trophy className="size-3.5 shrink-0 text-brand" />}
            <span className="text-sm font-semibold">{item.title}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{item.idea}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold tabular-nums text-brand">{item.total}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">#{item.rank}</div>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        {AXES.map((a) => (
          <div key={a.key}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium">{a.label}</span>
              <span className="text-[10px] text-muted">{a.hint}</span>
            </div>
            <ScoreBar value={item.scores[a.key]} />
          </div>
        ))}
      </div>

      {item.verdict && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed">{item.verdict}</p>
      )}

      {item.strengths.length > 0 && (
        <ul className="mt-3 space-y-1">
          {item.strengths.map((s, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-muted">
              <span className="text-success">+</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
      {item.risks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.risks.map((r, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-muted">
              <span className="text-danger">−</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Idea comparison: score 2–3 candidates against each other and rank them.
 *
 * The winner is whatever ranks first — the panel never picks separately from the
 * numbers, so the recommendation is always explained by the bars above it.
 */
export default function ComparePanel({
  onScrutinise,
  locale,
}: {
  onScrutinise: (idea: string) => void;
  locale: string;
}) {
  const [ideas, setIdeas] = useState<string[]>(["", ""]);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<IdeaComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Compare is Pro-only, so this is the gate most free users meet first.
  const [limitHit, setLimitHit] = useState<{
    reason: string;
    plan: "pro" | "team";
    limit: string;
  } | null>(null);

  const filled = ideas.map((i) => i.trim()).filter(Boolean);
  const canRun = filled.length >= 2 && status !== "loading";

  function setIdea(i: number, value: string) {
    setIdeas((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  async function compare() {
    if (!canRun) return;
    setStatus("loading");
    setError(null);
    setLimitHit(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideas: filled, locale }),
      });
      window.dispatchEvent(new Event(USAGE_EVENT));
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          upgradeTo?: string;
          upgrade?: boolean;
          quota?: string;
        };
        const limit = parseLimitError(res.status, body);
        if (limit) {
          setLimitHit(limit);
          setStatus("idle");
          return;
        }
        throw new Error(body.error ?? "Comparison failed.");
      }
      setResult((await res.json()) as IdeaComparison);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
      setStatus("error");
    }
  }

  const winner = result?.ideas[0];

  return (
    <div className="mt-5">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Scale className="size-4 text-brand" />
          <span className="text-sm font-semibold">Which idea is worth building?</span>
        </div>

        <div className="space-y-2">
          {ideas.map((idea, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <input
                value={idea}
                onChange={(e) => setIdea(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && compare()}
                placeholder={EXAMPLES[i] ?? "Another idea to weigh up…"}
                className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand/60"
              />
              {ideas.length > 2 && (
                <button
                  onClick={() => setIdeas((p) => p.filter((_, idx) => idx !== i))}
                  aria-label={`Remove idea ${i + 1}`}
                  className="shrink-0 rounded-md p-1.5 text-muted transition hover:bg-hover hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          {ideas.length < MAX_IDEAS ? (
            <button
              onClick={() => setIdeas((p) => [...p, ""])}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
            >
              <Plus className="size-3.5" /> Add a third
            </button>
          ) : (
            <span className="text-xs text-muted">Three is the maximum.</span>
          )}

          <button
            onClick={compare}
            disabled={!canRun}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Weighing them up…
              </>
            ) : (
              <>
                <Scale className="size-4" /> Compare
              </>
            )}
          </button>
        </div>

        {limitHit && (
          <UpgradePrompt
            reason={limitHit.reason}
            plan={limitHit.plan}
            limit={limitHit.limit}
            onDismiss={() => setLimitHit(null)}
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {status === "done" && result && winner && (
        <div className="mt-5">
          <div className="mb-4 rounded-xl border border-brand/40 bg-brand/10 p-4">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-brand">
              <Trophy className="size-4" /> Build “{winner.title}”
            </div>
            <p className="text-sm leading-relaxed">{result.rationale}</p>
            <button
              onClick={() => onScrutinise(winner.idea)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-1.5 text-sm font-semibold text-on-brand transition hover:opacity-90"
            >
              Scrutinise this one <ArrowRight className="size-3.5" />
            </button>
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}
          >
            {result.ideas.map((item, i) => (
              <IdeaColumn key={i} item={item} isWinner={i === 0} />
            ))}
          </div>

          {result.sources.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Sources
              </p>
              <ul className="space-y-1.5">
                {result.sources.map((c) => (
                  <li key={c.id} className="text-xs">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1.5 text-brand hover:underline"
                    >
                      <span className="text-muted">[{c.id}]</span>
                      <span>{c.title}</span>
                      <ExternalLink className="mt-0.5 size-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
