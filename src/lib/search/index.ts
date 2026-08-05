import { MockSearchProvider } from "./mock";
import { TavilyProvider } from "./tavily";
import type { SearchProvider } from "./types";
import { instrumentSearch } from "@/lib/health/instrument";

export type { SearchProvider, SearchResult, SearchOptions } from "./types";
export { hostnameOf } from "./types";

let cached: SearchProvider | null = null;

/**
 * Select the active search provider. TAVILY_API_KEY → Tavily, else Mock.
 * Force with SEARCH_PROVIDER=tavily|mock.
 */
export function getSearchProvider(): SearchProvider {
  if (cached) return cached;

  const forced = process.env.SEARCH_PROVIDER?.toLowerCase();
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (forced === "mock") cached = new MockSearchProvider();
  else if (forced === "tavily" && tavilyKey) cached = new TavilyProvider(tavilyKey);
  else if (tavilyKey) cached = new TavilyProvider(tavilyKey);
  else cached = new MockSearchProvider();

  cached = instrumentSearch(cached);
  return cached;
}
