import Link from "next/link";
import { ArrowRight, LayoutDashboard, Plus } from "lucide-react";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import { listProjects, type ProjectSummary } from "@/lib/db/projects";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic"; // always reflect the latest saved data

export default function DashboardPage() {
  const projects = listProjects();

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <LayoutDashboard className="size-6 text-brand" />
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">
            {projects.length === 0
              ? "Your saved projects will appear here."
              : `${projects.length} saved ${projects.length === 1 ? "project" : "projects"}.`}
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <Plus className="size-4" /> New idea
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </main>
  );
}

function nextAction(p: ProjectSummary): string {
  if (!p.hasValidation) return "Validate the idea";
  if (!p.hasResearch) return "Run DeepSearch";
  if (!p.hasPlan) return "Generate project plan";
  return "Open research workspace";
}

function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const steps: Array<[string, boolean]> = [
    ["Validation", p.hasValidation],
    ["Research", p.hasResearch],
    ["Plan", p.hasPlan],
  ];

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-4 transition hover:border-brand/40">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/projects/${p.id}`} className="font-semibold leading-snug hover:text-brand">
          {p.title}
        </Link>
        <DeleteProjectButton id={p.id} />
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{p.idea}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map(([label, done]) => (
          <span
            key={label}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              done
                ? "bg-emerald-500/15 text-emerald-500"
                : "border border-border text-muted"
            }`}
          >
            {done ? "✓ " : ""}
            {label}
          </span>
        ))}
      </div>

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

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
      <p className="text-lg font-semibold">No projects yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Start with an idea, validate it, run DeepSearch, and generate a plan — then hit{" "}
        <span className="font-medium text-foreground">Save to dashboard</span>.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        <Plus className="size-4" /> Start an idea
      </Link>
    </div>
  );
}
