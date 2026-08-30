import { keywordsFor } from "./prompts";
import type { SearchResult } from "@/lib/search/types";

/**
 * Keep only results that share meaningful vocabulary with the idea.
 *
 * Generic queries reliably return popular but unrelated pages. Demanding at
 * least one distinctive term in common is crude, but it removes the obviously
 * wrong links — and showing nothing beats showing something confidently wrong.
 *
 * Shared by DeepSearch and the watch runner so a result rejected in one place
 * can't be surfaced by the other.
 */
export function relevantToIdea(idea: string, results: SearchResult[]): SearchResult[] {
  const terms = new Set(
    keywordsFor(idea)
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  if (terms.size === 0) return results;

  return results.filter((r) => {
    const text = `${r.title} ${r.content ?? ""} ${r.url}`.toLowerCase();
    // Match on stems so "forecast" also catches "forecasting"/"forecasts".
    return [...terms].some((t) => text.includes(t.slice(0, Math.max(4, t.length - 2))));
  });
}
