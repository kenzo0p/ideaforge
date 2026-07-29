import {
  Bot,
  Compass,
  FolderKanban,
  Globe,
  Languages,
  LayoutDashboard,
  Network,
  Rocket,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { Layer2Capability } from "./types";

// UI metadata for the iNSIGHTS Layer 2 capabilities. `part` marks which build
// phase delivered it — the landing page renders this as a live roadmap.
export interface CapabilityMeta {
  id: Layer2Capability;
  icon: LucideIcon;
  title: string;
  blurb: string;
  part: number;
}

export const CAPABILITIES: CapabilityMeta[] = [
  {
    id: "problem-discovery",
    icon: Compass,
    title: "Problem Discovery",
    blurb: "Surface real-world problems worth solving in any domain, grounded in live signals.",
    part: 5,
  },
  {
    id: "deep-search",
    icon: Search,
    title: "DeepSearch",
    blurb: "Citation-backed research across trusted sources — no more 20 open tabs.",
    part: 2,
  },
  {
    id: "web-intelligence",
    icon: Globe,
    title: "Real-time Web Intelligence",
    blurb: "Fresh signals on markets, competitors, and prior art as you ideate.",
    part: 2,
  },
  {
    id: "project-hub",
    icon: Rocket,
    title: "Project HUB",
    blurb: "Auto-generated plan: milestones, architecture, stack, APIs, timeline.",
    part: 3,
  },
  {
    id: "knowledge-clustering",
    icon: Network,
    title: "Knowledge Clustering",
    blurb: "Groups findings into themes so the big picture is obvious at a glance.",
    part: 3,
  },
  {
    id: "dashboards",
    icon: LayoutDashboard,
    title: "Personalized Dashboards",
    blurb: "Every project's insights and next actions in one actionable view.",
    part: 4,
  },
  {
    id: "research-workspaces",
    icon: FolderKanban,
    title: "Research Workspaces",
    blurb: "Save, organize, and revisit sources, notes, and decisions per project.",
    part: 4,
  },
  {
    id: "ai-agents",
    icon: Bot,
    title: "AI Agents",
    blurb: "Telegram agent for reminders, progress tracking, and intelligent help.",
    part: 5,
  },
  {
    id: "multilingual",
    icon: Languages,
    title: "Multilingual Support",
    blurb: "Discover, research, and plan in the language you think in.",
    part: 5,
  },
];
