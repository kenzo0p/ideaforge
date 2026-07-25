// ---------------------------------------------------------------------------
// Web search abstraction
//
// DeepSearch and Real-time Web Intelligence run through this seam. A real
// provider (Tavily) and a keyless Mock both implement it, so research works with
// zero API keys and swaps to live web results the moment a key is present.
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  /** Hostname, e.g. "arxiv.org" — shown as the source label. */
  source: string;
  /** Short extract used as grounding context for the LLM. */
  content: string;
  /** Provider relevance score, if available (0–1). */
  score?: number;
}

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

/** Best-effort hostname extraction for the source label. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}
