import { getProvider } from "@/lib/ai";
import { getSearchProvider, type SearchResult } from "@/lib/search";
import { discoverResources } from "@/lib/resources";
import {
  deepResearchMessages,
  deepResearchQueries,
  documentReviewMessages,
  keywordsFor,
  problemDiscoveryMessages,
  problemDiscoveryQueries,
  problemValidationMessages,
  projectHubMessages,
  resourceQueries,
} from "./prompts";
import type {
  ApiRecommendation,
  ArchitectureComponent,
  Citation,
  DiscoverInput,
  DiscoveredProblem,
  DocumentReview,
  IdeaInput,
  KnowledgeCluster,
  Layer2Capability,
  Milestone,
  ProblemDiscovery,
  ProjectPlan,
  ResearchReport,
  Resource,
  ReviewPoint,
  SectionNote,
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

  /** Discover real-world problems worth solving in a domain. */
  discoverProblems(input: DiscoverInput, signal?: AbortSignal): Promise<ProblemDiscovery>;

  /** Review an uploaded deck/document and suggest concrete improvements. */
  reviewDocument(
    input: { fileName: string; kind: "pptx" | "pdf"; sectionCount: number; text: string; truncated: boolean; locale?: string },
    signal?: AbortSignal,
  ): Promise<DocumentReview>;

  /** Project HUB + Knowledge Clustering: full build plan (Part 3). */
  projectHub(
    input: IdeaInput,
    research: ResearchReport | null,
    signal?: AbortSignal,
  ): Promise<ProjectPlan>;
}

class DefaultLayer2 implements Layer2Service {
  readonly capabilities: Record<Layer2Capability, boolean> = {
    "problem-discovery": true,
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
      maxTokens: 8000,
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

  async reviewDocument(
    input: {
      fileName: string;
      kind: "pptx" | "pdf";
      sectionCount: number;
      text: string;
      truncated: boolean;
      locale?: string;
    },
    signal?: AbortSignal,
  ): Promise<DocumentReview> {
    const provider = getProvider();
    const raw = await provider.generateText({
      messages: documentReviewMessages(
        input.fileName,
        input.kind,
        input.sectionCount,
        input.text,
        input.locale,
      ),
      // Headroom so a detailed review is never cut mid-JSON.
      maxTokens: 6000,
      json: true,
      signal,
    });
    const parsed = safeParse(raw);
    const score = Number(parsed.score);

    return {
      fileName: input.fileName,
      kind: input.kind,
      sectionCount: input.sectionCount,
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
      verdict: asString(parsed.verdict, "No verdict was produced."),
      strengths: asArray<ReviewPoint>(parsed.strengths),
      improvements: asArray<ReviewPoint>(parsed.improvements),
      missing: asArray<string>(parsed.missing),
      sectionNotes: asArray<SectionNote>(parsed.sectionNotes),
      truncated: input.truncated,
      demo: provider.isMock,
    };
  }

  async discoverProblems(input: DiscoverInput, signal?: AbortSignal): Promise<ProblemDiscovery> {
    const searcher = getSearchProvider();
    const domain = input.domain?.trim() || "";

    // Ground discovery in current, real-world signals.
    const batches = await Promise.all(
      problemDiscoveryQueries(domain).map((q) =>
        searcher.search(q, { maxResults: 4, signal }).catch(() => [] as SearchResult[]),
      ),
    );
    const results = dedupeByUrl(batches.flat()).slice(0, 10);
    const sources: Citation[] = results.map((r, i) => ({
      id: i + 1,
      title: r.title,
      url: r.url,
      source: r.source,
      snippet: r.content?.slice(0, 240),
    }));

    const raw = await getProvider().generateText({
      messages: problemDiscoveryMessages(domain, results, input.locale),
      maxTokens: 4000,
      json: true,
      signal,
    });
    const parsed = safeParse(raw);

    return {
      domain: domain || "general",
      problems: Array.isArray(parsed.problems) ? (parsed.problems as DiscoveredProblem[]) : [],
      sources,
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

    // Prefer real, dedicated sources: GitHub (repos), Kaggle (datasets),
    // CORE (papers). Keyword queries (not the full sentence) return far better
    // results from these APIs. Each bucket falls back to categorized web-search
    // results when its provider isn't configured or returns nothing.
    const discovered = await discoverResources(keywordsFor(input.idea));
    let { repos, datasets, papers } = discovered;

    if (repos.length === 0 || datasets.length === 0 || papers.length === 0) {
      const batches = await Promise.all(
        resourceQueries(input.idea).map((q) =>
          searcher.search(q, { maxResults: 3, signal }).catch(() => [] as SearchResult[]),
        ),
      );
      const fallback = categorizeResources(dedupeByUrl(batches.flat()));
      if (repos.length === 0) repos = fallback.repos;
      if (datasets.length === 0) datasets = fallback.datasets;
      if (papers.length === 0) papers = fallback.papers;
    }

    // LLM designs the plan; it sees resource titles but never sets their URLs.
    const resourceTitles = [...repos, ...datasets, ...papers].map((r) => r.title).slice(0, 9);
    const raw = await provider.generateText({
      messages: projectHubMessages(input.idea, research, resourceTitles, input.locale),
      temperature: 0.35,
      maxTokens: 6000,
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

/** Parse model JSON, tolerating ```json fences, prose, and mild truncation. */
function safeParse(raw: string): Record<string, unknown> {
  // Strip surrounding markdown code fences (Claude wraps JSON in ```json … ```).
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Greedy braces first (complete object), then a repair pass for truncation.
    const match = cleaned.match(/\{[\s\S]*\}/);
    const candidate = match ? match[0] : cleaned;
    try {
      return JSON.parse(candidate);
    } catch {
      const repaired = repairTruncatedJson(candidate);
      if (repaired) {
        try {
          return JSON.parse(repaired);
        } catch {
          /* give up */
        }
      }
    }
    return {};
  }
}

/**
 * Best-effort repair of JSON truncated mid-generation: drop any trailing partial
 * token, then close open strings/brackets so the salvageable prefix parses.
 */
function repairTruncatedJson(s: string): string | null {
  let str = s.replace(/,\s*$/, "");
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of str) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    else if (!inString) {
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
  }
  if (!stack.length && !inString) return null; // nothing to repair
  if (inString) str += '"';
  str = str.replace(/,\s*$/, "");
  while (stack.length) str += stack.pop() === "{" ? "}" : "]";
  return str;
}

let instance: Layer2Service | null = null;

export function getLayer2(): Layer2Service {
  if (!instance) instance = new DefaultLayer2();
  return instance;
}
