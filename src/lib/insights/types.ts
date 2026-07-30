// ---------------------------------------------------------------------------
// iNSIGHTS Layer 2 — domain model
//
// These types describe the outputs of the Layer 2 capabilities the copilot
// exposes. They are provider-agnostic: today they're produced by an LLM (or the
// Mock), tomorrow by the real iNSIGHTS Layer 2 API — feature/UI code depends on
// these shapes, never on how they were produced.
// ---------------------------------------------------------------------------

/** The Layer 2 capabilities from the track brief, plus problem discovery. */
export type Layer2Capability =
  | "problem-discovery"
  | "deep-search"
  | "project-hub"
  | "ai-agents"
  | "web-intelligence"
  | "dashboards"
  | "knowledge-clustering"
  | "research-workspaces"
  | "multilingual";

/** A numbered citation backing a research claim (DeepSearch, Part 2). */
export interface Citation {
  id: number;
  title: string;
  url: string;
  source: string;
  snippet?: string;
}

/** One existing solution in the competitive comparison. */
export interface SolutionComparison {
  name: string;
  what: string;
  strengths: string[];
  gaps: string[];
  /** Citation ids that back this entry. */
  citations?: number[];
}

/** An unmet need / innovation opportunity surfaced from the research. */
export interface ResearchGap {
  title: string;
  description: string;
  opportunity: string;
}

/** Full DeepSearch output: grounded narrative + structured findings. */
export interface ResearchReport {
  /** The searches that were run — shows the DeepSearch work. */
  queries: string[];
  /** Markdown narrative using [n] markers that reference `citations`. */
  summaryMarkdown: string;
  citations: Citation[];
  existingSolutions: SolutionComparison[];
  gaps: ResearchGap[];
  /** True when results came from the offline demo provider. */
  demo: boolean;
}

/** Output of problem validation — the Part 1 vertical slice. */
export interface ProblemValidation {
  /** Streamed markdown narrative shown in the UI. */
  markdown: string;
}

/** The user's seed idea plus context. */
export interface IdeaInput {
  idea: string;
  /** BCP-47 tag for multilingual output; defaults to "en". */
  locale?: string;
}

// --- Deck / document review ------------------------------------------------

export interface ReviewPoint {
  title: string;
  detail: string;
}

export interface SectionNote {
  /** Slide or page number (1-based). */
  index: number;
  issue: string;
  fix: string;
}

export interface DocumentReview {
  fileName: string;
  kind: "pptx" | "pdf";
  sectionCount: number;
  /** 0–100 readiness score with a one-line justification. */
  score: number;
  verdict: string;
  strengths: ReviewPoint[];
  improvements: ReviewPoint[];
  missing: string[];
  sectionNotes: SectionNote[];
  truncated: boolean;
  demo: boolean;
}

// --- Problem Discovery -----------------------------------------------------

/** A real-world problem worth solving, surfaced from current signals. */
export interface DiscoveredProblem {
  title: string;
  description: string;
  whoIsAffected: string;
  whyNow: string;
  signals: string[];
  /** A concrete one-line idea that feeds straight into validation. */
  starterIdea: string;
  citations?: number[];
}

export interface ProblemDiscovery {
  /** The domain explored (or "general"). */
  domain: string;
  problems: DiscoveredProblem[];
  sources: Citation[];
  demo: boolean;
}

export interface DiscoverInput {
  /** Domain / interest to explore, e.g. "education", "rural healthcare". */
  domain?: string;
  locale?: string;
}

// --- Project HUB (Part 3) --------------------------------------------------

export interface TechStackItem {
  category: string; // e.g. "Frontend", "Backend", "AI/ML", "Data", "Infra"
  choice: string;
  why: string;
}

export interface ArchitectureComponent {
  name: string;
  responsibility: string;
  /** Names of other components this one talks to. */
  connectsTo: string[];
}

export interface Milestone {
  phase: string; // e.g. "Week 1–2 · Foundation"
  goal: string;
  tasks: string[];
  deliverable: string;
}

export interface ApiRecommendation {
  name: string;
  purpose: string;
  url?: string;
}

/** A grounded external resource (repo / dataset / paper) with a real URL. */
export interface Resource {
  title: string;
  url: string;
  source: string;
  description?: string;
}

/** Knowledge Clustering: findings grouped into a theme. */
export interface KnowledgeCluster {
  theme: string;
  summary: string;
  items: string[];
}

/** Full Project HUB output. */
export interface ProjectPlan {
  title: string;
  pitch: string;
  techStack: TechStackItem[];
  architecture: ArchitectureComponent[];
  milestones: Milestone[];
  apis: ApiRecommendation[];
  repos: Resource[];
  datasets: Resource[];
  papers: Resource[];
  clusters: KnowledgeCluster[];
  demo: boolean;
}
