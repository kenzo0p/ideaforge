"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Coins,
  Copy,
  Lightbulb,
  Loader2,
  PencilRuler,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import TokenBadge, { usageFromHeaders } from "@/components/TokenBadge";
import type { TokenUsage } from "@/lib/ai/usage-shared";
import type {
  PromptRecommendation,
  PromptSet,
  RecommendationKind,
  StructuredPrompt,
} from "@/lib/pipeline/types";

const fmt = (n: number) => n.toLocaleString();

const ADVICE: Record<RecommendationKind, { icon: typeof Lightbulb; className: string; label: string }> = {
  pick: { icon: ArrowRight, className: "text-success", label: "Start here" },
  sharpen: { icon: PencilRuler, className: "text-warning", label: "Sharpen the idea" },
  cost: { icon: Coins, className: "text-brand", label: "Cost" },
  warn: { icon: AlertTriangle, className: "text-warning", label: "Worth knowing" },
};

/**
 * One rough line in, several runnable prompts out.
 *
 * The forecast beside each prompt is the reason this is a feature rather than a
 * text box. Seeing that one angle costs three times another, before running
 * either, is what lets someone spend a budget deliberately — and the comparison
 * between the three is far firmer than any of the absolute numbers, which is
 * said plainly rather than left to be inferred.
 */
export default function PromptStudio() {
  const [idea, setIdea] = useState("");
  const [set, setSet] = useState<PromptSet | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSet(null);
          return setError(body.error ?? "Could not draft prompts just now.");
        }
        setUsage(usageFromHeaders(res.headers));
        setSet((await res.json()) as PromptSet);
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5">
        <label className="block">
          <span className="text-xs font-semibold">Your idea, in one line</span>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={2}
            placeholder="A tool that helps hostel kitchens predict how many students will eat dinner"
            className="mt-1 w-full resize-none rounded-lg border border-border-strong bg-surface p-3 text-sm outline-none focus:border-brand/60"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={pending || idea.trim().length < 8}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {pending ? "Drafting…" : "Draft prompts"}
          </button>
          {usage && !pending && <TokenBadge usage={usage} />}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {set && !pending && <PromptSetView set={set} />}
    </>
  );
}

export function PromptSetView({ set }: { set: PromptSet }) {
  const { totalForecast: t } = set;

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Read as</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{set.restated}</p>
        <p className="mt-2 text-[11px] text-muted">
          If that is not what you meant, fix the line above before spending anything — every
          prompt below inherits this reading.
        </p>
      </section>

      {set.demo && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No language model is connected, so these are templates filled with your words
            rather than prompts written for your idea. The forecasts are still real
            arithmetic on the text.
          </span>
        </p>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">
            {set.prompts.length} prompts, {fmt(t.totalMid)} tokens to run them all
          </h2>
          <span className="text-[11px] text-muted">
            {fmt(t.promptTokens)} to send · {fmt(t.outputLow)}–{fmt(t.outputHigh)} back
          </span>
        </div>
        <ul className="space-y-3">
          {set.prompts.map((p, i) => (
            <PromptCard key={p.id} prompt={p} index={i + 1} peak={t.totalMid} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4 text-brand" />
          What to do next
        </h2>
        <p className="mb-3 max-w-prose text-xs text-muted">
          Worked out from your line and the arithmetic above, not asked of the model — so you
          can check every one of them by reading what you typed.
        </p>
        <ul className="space-y-2">
          {set.recommendations.map((r, i) => (
            <Advice key={`${r.kind}-${i}`} rec={r} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PromptCard({
  prompt,
  index,
  peak,
}: {
  prompt: StructuredPrompt;
  index: number;
  peak: number;
}) {
  const [copied, setCopied] = useState(false);
  const f = prompt.forecast;
  const share = peak > 0 ? Math.round((f.totalMid / peak) * 100) : 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the text is selectable either way.
    }
  }

  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-brand/12 text-[11px] font-semibold text-brand">
          {index}
        </span>
        <h3 className="text-sm font-semibold">{prompt.angle}</h3>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted"
          title={`${fmt(f.promptTokens)} tokens to send, ${fmt(f.outputLow)}–${fmt(f.outputHigh)} expected back. A forecast from text length, not a measurement.`}
        >
          <Coins className="size-3 shrink-0" />
          <span className="tabular-nums font-medium text-foreground">~{fmt(f.totalMid)}</span>
          <span>tokens forecast</span>
        </span>
      </div>

      {prompt.rationale && (
        <p className="mt-1.5 max-w-prose text-xs text-muted">{prompt.rationale}</p>
      )}

      <div className="mt-3 rounded-lg border border-border bg-surface p-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {prompt.prompt}
        </p>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
            <span>
              {fmt(f.promptTokens)} to send · {fmt(f.outputLow)}–{fmt(f.outputHigh)} back
            </span>
            <span className="tabular-nums">{share}% of the batch</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-brand-solid" style={{ width: `${share}%` }} />
          </div>
        </div>
        <button
          onClick={copy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-hover"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>

      {prompt.expectSections.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          <span className="font-medium text-foreground">A good answer contains:</span>{" "}
          {prompt.expectSections.join(" · ")}
        </p>
      )}
    </li>
  );
}

function Advice({ rec }: { rec: PromptRecommendation }) {
  const { icon: Icon, className, label } = ADVICE[rec.kind];
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{rec.title}</span>
        <span className="mt-0.5 block leading-relaxed text-muted">{rec.detail}</span>
        <span className={`mt-0.5 block text-[10px] uppercase tracking-wide ${className}`}>
          {label}
        </span>
      </span>
    </li>
  );
}

/** Offered once a set exists: the natural next step is to actually run one. */
export function RunItNext() {
  return (
    <p className="mt-5 text-center text-xs text-muted">
      Happy with one of these?{" "}
      <Link href="/" className="inline-flex items-center gap-1 text-brand underline">
        <Sparkles className="size-3" /> put the idea through Scrutan
      </Link>{" "}
      and it will be checked as well as answered.
    </p>
  );
}
