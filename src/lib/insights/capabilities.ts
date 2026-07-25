import type { Layer2Capability } from "./types";

// UI metadata for the eight iNSIGHTS Layer 2 capabilities. `part` marks which
// build phase delivers it — the landing page renders this as a live roadmap.
export interface CapabilityMeta {
  id: Layer2Capability;
  icon: string;
  title: string;
  blurb: string;
  part: number;
}

export const CAPABILITIES: CapabilityMeta[] = [
  {
    id: "deep-search",
    icon: "🔍",
    title: "DeepSearch",
    blurb: "Citation-backed research across trusted sources — no more 20 open tabs.",
    part: 2,
  },
  {
    id: "web-intelligence",
    icon: "🌐",
    title: "Real-time Web Intelligence",
    blurb: "Fresh signals on markets, competitors, and prior art as you ideate.",
    part: 2,
  },
  {
    id: "project-hub",
    icon: "🚀",
    title: "Project HUB",
    blurb: "Auto-generated plan: milestones, architecture, stack, APIs, timeline.",
    part: 3,
  },
  {
    id: "knowledge-clustering",
    icon: "🧠",
    title: "Knowledge Clustering",
    blurb: "Groups findings into themes so the big picture is obvious at a glance.",
    part: 3,
  },
  {
    id: "dashboards",
    icon: "📊",
    title: "Personalized Dashboards",
    blurb: "Every project's insights and next actions in one actionable view.",
    part: 4,
  },
  {
    id: "research-workspaces",
    icon: "📚",
    title: "Research Workspaces",
    blurb: "Save, organize, and revisit sources, notes, and decisions per project.",
    part: 4,
  },
  {
    id: "ai-agents",
    icon: "🤖",
    title: "AI Agents",
    blurb: "WhatsApp / Telegram agents for reminders, progress tracking, and help.",
    part: 5,
  },
  {
    id: "multilingual",
    icon: "🌍",
    title: "Multilingual Support",
    blurb: "Discover, research, and plan in the language you think in.",
    part: 5,
  },
];
