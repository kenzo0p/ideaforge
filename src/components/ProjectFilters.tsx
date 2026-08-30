"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import ProjectCard from "@/components/ProjectCard";
import type { GroundingSummary } from "@/lib/db/grounding";
import type { ProjectSummary } from "@/lib/db/projects";

export type SortKey = "recent" | "alpha";
export type FilterKey = "all" | "in-progress" | "complete" | "shared";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "in-progress", label: "In progress" },
  { key: "complete", label: "Plan ready" },
  { key: "shared", label: "Shared" },
];

/** Search + filter + sort controls over the project grid. */
export default function ProjectFilters({
  projects,
  doneCounts,
  grounding,
}: {
  projects: ProjectSummary[];
  /** Completed-milestone counts keyed by project id. */
  doneCounts: Record<string, number>;
  /** Verification summaries keyed by project id; missing means never checked. */
  grounding: Record<string, GroundingSummary>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => {
      if (q && !(`${p.title} ${p.idea}`.toLowerCase().includes(q))) return false;
      if (filter === "complete") return p.hasPlan;
      if (filter === "in-progress") return !p.hasPlan;
      if (filter === "shared") return p.shared;
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === "alpha" ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt,
    );
    return list;
  }, [projects, query, filter, sort]);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-lg border border-border-strong bg-card py-2 pl-9 pr-8 text-sm outline-none focus:border-brand/60"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-brand-solid text-on-brand"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort projects"
            className="rounded-lg border border-border bg-card px-2 py-2 text-xs outline-none focus:border-brand/60"
          >
            <option value="recent">Recent</option>
            <option value="alpha">A–Z</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted">
          No projects match those filters.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              doneMilestones={doneCounts[p.id] ?? 0}
              grounding={grounding[p.id]}
            />
          ))}
        </div>
      )}
    </>
  );
}
