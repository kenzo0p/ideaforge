import { getProvider } from "@/lib/ai";
import { getSearchProvider, type SearchResult } from "@/lib/search";
import {
  deepResearchMessages,
  deepResearchQueries,
  problemValidationMessages,
  projectHubMessages,
  resourceQueries,
} from "./prompts";
import type {
  ApiRecommendation,
  ArchitectureComponent,
  Citation,
  IdeaInput,
  KnowledgeCluster,
  Layer2Capability,
  Milestone,
  ProjectPlan,
  ResearchReport,
  Resource,
  SolutionComparison,
  ResearchGap,
  TechStackItem,
} from "./types";

// ---------------------------------------------------------------------------
// iNSIGHTS Layer 2 service
//
// The single seam between the copilot's features and whatever powers them. Each
// method maps to a Layer 2 capability from the track brief. Swapping in the real
// Layer 2 API means changing only this file.
// ---------------------------------------------------------------------------

export interface Layer2Service {
  /** Which capabilities are live — drives UI badges and the roadmap. */
  readonly capabilities: Record<Layer2Capability, boolean>;

  /** Stream a citation-free problem validation (Part 1). */
  validateProblem(input: IdeaInput, signal?: AbortSignal): AsyncIterable<string>;

  /** DeepSearch + Real-time Web Intelligence: grounded research (Part 2). */
  deepSearch(input: IdeaInput, signal?: AbortSignal): Promise<ResearchReport>;

  /** Project HUB + Knowledge Clustering: full build plan (Part 3). */
  projectHub(
    input: IdeaInput,
    research: ResearchReport | null,
    signal?: AbortSignal,
  ): Promise<ProjectPlan>;
}

class DefaultLayer2 implements Layer2Service {
  readonly capabilities: Record<Layer2Capability, boolean> = {
    "deep-search": true,
    "web-intelligence": true,
    "project-hub": true,
    "knowledge-clustering": true,
    dashboards: true,
    "research-workspaces": true,
    "ai-agents": true,
    multilingual: true, // locale is threaded through prompts from day one
  };

  validateProblem(input: IdeaInput, signal?: AbortSignal): AsyncIterable<string> {
    return getProvider().streamText({
      messages: problemValidationMessages(input),
      temperature: 0.3,
      maxTokens: 1200,
      signal,
    });
  }

  async deepSearch(input: IdeaInput, signal?: AbortSignal): Promise<ResearchReport> {
    const searcher = getSearchProvider();
    const queries = deepResearchQueries(input.idea);

    // Real-time Web Intelligence: fan out searches, then dedupe by URL.
    const batches = await Promise.all(
      queries.map((q) =>
        searcher.search(q, { maxResults: 4, signal }).catch(() => [] as SearchResult[]),
      ),
    );
    const results = dedupeByUrl(batches.flat()).slice(0, 10);

    // Build citations from the actual results so URLs are never hallucinated.
    const citations: Citation[] = results.map((r, i) => ({
      id: i + 1,
      title: r.title,
      url: r.url,
      source: r.source,
      snippet: r.content?.slice(0, 240),
    }));

    // LLM grounds a briefing in the numbered sources.
    const raw = await getProvider().generateText({
      messages: deepResearchMessages(input.idea, results, input.locale),
      temperature: 0.3,
      maxTokens: 1800,
      json: true,
      signal,
    });

    const parsed = safeParse(raw);

    return {
      queries,
      summaryMarkdown:
        typeof parsed.summaryMarkdown === "string"
          ? parsed.summaryMarkdown
          : "_No summary was produced._",
      citations,
      existingSolutions: Array.isArray(parsed.existingSolutions)
        ? (parsed.existingSolutions as SolutionComparison[])
        : [],
      gaps: Array.isArray(parsed.gaps) ? (parsed.gaps as ResearchGap[]) : [],
      demo: searcher.isMock || getProvider().isMock,
    };
  }

  async projectHub(
    input: IdeaInput,
    research: ResearchReport | null,
    signal?: AbortSignal,
  ): Promise<ProjectPlan> {
    const searcher = getSearchProvider();
    const provider = getProvider();

    // Ground repo/dataset/paper recommendations in real search results.
    const batches = await Promise.all(
      resourceQueries(input.idea).map((q) =>
        searcher.search(q, { maxResults: 3, signal }).catch(() => [] as SearchResult[]),
      ),
    );
    const resources = dedupeByUrl(batches.flat());
    const { repos, datasets, papers } = categorizeResources(resources);

    // LLM designs the plan; it sees resource titles but never sets their URLs.
    const raw = await provider.generateText({
      messages: projectHubMessages(
        input.idea,
        research,
        resources.map((r) => r.title).slice(0, 9),
        input.locale,
      ),
      temperature: 0.35,
      maxTokens: 2400,
      json: true,
      signal,
    });
    const parsed = safeParse(raw);

    return {
      title: asString(parsed.title, "Untitled Project"),
      pitch: asString(parsed.pitch, ""),
      techStack: asArray<TechStackItem>(parsed.techStack),
      architecture: asArray<ArchitectureComponent>(parsed.architecture),
      milestones: asArray<Milestone>(parsed.milestones),
      apis: asArray<ApiRecommendation>(parsed.apis),
      repos,
      datasets,
      papers,
      clusters: asArray<KnowledgeCluster>(parsed.clusters),
      demo: searcher.isMock || provider.isMock,
    };
  }
}

/** Bucket raw search results into repos / datasets / papers by domain. */
function categorizeResources(results: SearchResult[]): {
  repos: Resource[];
  datasets: Resource[];
  papers: Resource[];
} {
  const repos: Resource[] = [];
  const datasets: Resource[] = [];
  const papers: Resource[] = [];

  for (const r of results) {
    const res: Resource = {
      title: r.title,
      url: r.url,
      source: r.source,
      description: r.content?.slice(0, 160),
    };
    const host = r.source.toLowerCase();
    const text = `${r.title} ${r.url}`.toLowerCase();
    if (host.includes("github.") || host.includes("gitlab.")) repos.push(res);
    else if (
      host.includes("kaggle") ||
      host.includes("huggingface") ||
      host.includes("data.") ||
      text.includes("dataset")
    )
      datasets.push(res);
    else if (
      host.includes("arxiv") ||
      host.includes("semanticscholar") ||
      host.endsWith(".edu") ||
      text.includes("paper") ||
      text.includes("survey")
    )
      papers.push(res);
    else datasets.push(res); // sensible default bucket
  }

  return { repos: repos.slice(0, 4), datasets: datasets.slice(0, 4), papers: papers.slice(0, 4) };
}

// --- helpers ---------------------------------------------------------------

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Parse model JSON, tolerating stray prose or code fences around it. */
function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

let instance: Layer2Service | null = null;

export function getLayer2(): Layer2Service {
  if (!instance) instance = new DefaultLayer2();
  return instance;
}
