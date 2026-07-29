import Link from "next/link";
import { Bot, Check, FolderKanban, Rocket, Search, Sparkles } from "lucide-react";

export type ProjectTabKey = "validation" | "research" | "plan" | "workspace" | "collaborate";

export const PROJECT_TABS = [
  { key: "validation", label: "Validation", icon: Sparkles },
  { key: "research", label: "Research", icon: Search },
  { key: "plan", label: "Plan", icon: Rocket },
  { key: "workspace", label: "Workspace", icon: FolderKanban },
  { key: "collaborate", label: "Collaborate", icon: Bot },
] as const satisfies ReadonlyArray<{ key: ProjectTabKey; label: string; icon: unknown }>;

/**
 * Server-rendered tab bar. Tabs are plain links, so only the active section is
 * ever rendered, the URL is always shareable, and the sidebar's nested links
 * stay perfectly in sync with no client state to reconcile.
 */
export default function ProjectTabBar({
  projectId,
  active,
  ready,
}: {
  projectId: string;
  active: ProjectTabKey;
  /** Which sections have saved content (drives the ✓ marks). */
  ready: Partial<Record<ProjectTabKey, boolean>>;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
    >
      {PROJECT_TABS.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            role="tab"
            aria-selected={isActive}
            href={`/projects/${projectId}?tab=${t.key}`}
            scroll={false}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-brand text-white shadow-sm"
                : "text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{t.label}</span>
            {ready[t.key] && (
              <Check
                className={`size-3.5 shrink-0 ${isActive ? "text-white/80" : "text-emerald-500"}`}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
