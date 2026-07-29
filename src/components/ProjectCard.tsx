"use client";

import Link from "next/link";
import { ArrowRight, Globe } from "lucide-react";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import type { ProjectSummary } from "@/lib/db/projects";
import { timeAgo } from "@/lib/format";

function nextAction(p: ProjectSummary): string {
  if (!p.hasValidation) return "Validate the idea";
  if (!p.hasResearch) return "Run DeepSearch";
  if (!p.hasPlan) return "Generate project plan";
  return "Open research workspace";
}

export default function ProjectCard({
  project: p,
  doneMilestones,
}: {
  project: ProjectSummary;
  doneMilestones: number;
}) {
  const steps: Array<[string, boolean]> = [
    ["Validation", p.hasValidation],
    ["Research", p.hasResearch],
    ["Plan", p.hasPlan],
  ];
  const pct =
    p.totalMilestones > 0 ? Math.round((doneMilestones / p.totalMilestones) * 100) : 0;

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-4 transition hover:border-brand/40">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/projects/${p.id}`} className="font-semibold leading-snug hover:text-brand">
          {p.title}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {p.shared && (
            <span title="Public link enabled" className="text-muted">
              <Globe className="size-3.5" />
            </span>
          )}
          <DeleteProjectButton id={p.id} />
        </div>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{p.idea}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map(([label, done]) => (
          <span
            key={label}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              done ? "bg-emerald-500/15 text-emerald-500" : "border border-border text-muted"
            }`}
          >
            {done ? "✓ " : ""}
            {label}
          </span>
        ))}
      </div>

      {/* Build progress across the plan's milestones */}
      {p.totalMilestones > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>Build progress</span>
            <span>
              {doneMilestones}/{p.totalMilestones}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full transition-all ${
                pct === 100 ? "bg-emerald-500" : "bg-brand"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted">
        <span>{timeAgo(p.updatedAt)}</span>
        <Link
          href={`/projects/${p.id}`}
          className="inline-flex items-center gap-1 font-medium text-brand opacity-0 transition group-hover:opacity-100"
        >
          {nextAction(p)} <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
