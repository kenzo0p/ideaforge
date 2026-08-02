import { hostnameOf, type SearchOptions, type SearchProvider, type SearchResult } from "./types";

// Tavily search — an AI-friendly search API that returns clean, extractable
// content. Activated when TAVILY_API_KEY is set. https://tavily.com
export class TavilyProvider implements SearchProvider {
  readonly id = "tavily";
  readonly label = "Tavily";
  readonly isMock = false;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = process.env.TAVILY_BASE_URL ?? "https://api.tavily.com",
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: "advanced",
        max_results: options.maxResults ?? 5,
        include_answer: false,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Tavily search failed (${res.status}): ${detail}`);
    }

    const data: { results?: Array<{ title: string; url: string; content: string; score?: number }> } =
      await res.json();

    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      source: hostnameOf(r.url),
      content: r.content ?? "",
      score: r.score,
    }));
  }
}
