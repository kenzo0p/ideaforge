"use client";

import { Coins } from "lucide-react";
import type { TokenUsage } from "@/lib/ai/usage-shared";

/** Read the token figures a JSON route reported in its headers. */
export function usageFromHeaders(h: Headers): TokenUsage | null {
  const input = Number(h.get("X-Tokens-In"));
  const output = Number(h.get("X-Tokens-Out"));
  if (!Number.isFinite(input) || !Number.isFinite(output) || input + output === 0) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    calls: 1,
    estimated: h.get("X-Tokens-Estimated") === "true",
    provider: h.get("X-Provider") ?? "",
    model: h.get("X-Model") ?? "",
  };
}

const fmt = (n: number) => n.toLocaleString();

/**
 * What this run cost, shown where the run happened.
 *
 * Deliberately quiet. The figure is useful when someone goes looking for it and
 * noise the rest of the time, so it sits at the end of a result rather than at
 * the top, and reads as a footnote rather than a headline.
 *
 * An estimated total says so in the label, not in a tooltip nobody opens. Demo
 * mode makes no model calls, so its figure is arithmetic on text length — a
 * real distinction, and one the reader should not have to hover to discover.
 */
export default function TokenBadge({
  usage,
  className = "",
}: {
  usage: TokenUsage | null;
  className?: string;
}) {
  if (!usage) return null;
  const total = usage.inputTokens + usage.outputTokens;
  if (total === 0) return null;

  const detail =
    `${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out` +
    (usage.calls > 1 ? ` · ${usage.calls} model calls` : "") +
    (usage.model ? ` · ${usage.model}` : "");

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted ${className}`}
      title={detail}
    >
      <Coins className="size-3 shrink-0" />
      <span className="tabular-nums font-medium text-foreground">{fmt(total)}</span>
      <span>{usage.estimated ? "tokens (estimated)" : "tokens"}</span>
      <span className="hidden opacity-70 sm:inline">
        · {fmt(usage.inputTokens)} in / {fmt(usage.outputTokens)} out
      </span>
    </span>
  );
}
