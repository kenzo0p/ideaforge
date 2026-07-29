"use client";

import { useState, useTransition } from "react";
import {
  Boxes,
  Check,
  Database,
  ExternalLink,
  FileText,
  GitBranch,
  Layers,
  Milestone as MilestoneIcon,
  Plug,
  Rocket,
} from "lucide-react";
import { toggleMilestoneAction } from "@/lib/actions";
import type { ProjectPlan, Resource } from "@/lib/insights/types";

export default function ProjectPlanPanel({
  plan,
  provider,
  projectId,
  completedMilestones = [],
}: {
  plan: ProjectPlan;
  provider: string | null;
  /** When set, milestones become checkable and progress is persisted. */
  projectId?: string;
  completedMilestones?: number[];
}) {
  const [done, setDone] = useState<number[]>(completedMilestones);
  const [pending, startTransition] = useTransition();

  function toggle(idx: number, next: boolean) {
    if (!projectId) return;
    // Optimistic: reflect immediately, then persist.
    setDone((prev) => (next ? [...prev, idx] : prev.filter((i) => i !== idx)));
    startTransition(() => toggleMilestoneAction(projectId, idx, next));
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="size-4 text-brand" />
          Project HUB — Build Plan
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {plan.demo && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-500">
              Demo data
            </span>
          )}
          {provider && (
            <span className="rounded-full border border-border px-2 py-0.5">{provider}</span>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="mb-6 rounded-xl bg-gradient-to-br from-brand/10 to-brand-2/10 p-4">
        <h2 className="text-xl font-bold">{plan.title}</h2>
        {plan.pitch && <p className="mt-1 text-sm text-foreground/80">{plan.pitch}</p>}
      </div>

      {/* Tech stack */}
      {plan.techStack.length > 0 && (
        <Section icon={<Layers className="size-4 text-brand" />} title="Recommended tech stack">
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.techStack.map((t, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  {t.category}
                </div>
                <div className="font-semibold">{t.choice}</div>
                <p className="mt-0.5 text-xs text-muted">{t.why}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Architecture */}
      {plan.architecture.length > 0 && (
        <Section icon={<Boxes className="size-4 text-brand" />} title="Architecture">
          <div className="space-y-2">
            {plan.architecture.map((c, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-sm text-muted"> — {c.responsibility}</span>
                </div>
                {c.connectsTo.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.connectsTo.map((x) => (
                      <span
                        key={x}
                        className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand"
                      >
                        → {x}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Timeline / milestones */}
      {plan.milestones.length > 0 && (
        <Section icon={<MilestoneIcon className="size-4 text-brand" />} title="Roadmap & timeline">
          {/* Progress summary — only for saved projects (tracking needs an id). */}
          {projectId && plan.milestones.length > 0 && (
            <div className="mb-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${Math.round((done.length / plan.milestones.length) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-muted">
                {done.length}/{plan.milestones.length} done
              </span>
            </div>
          )}
          <ol className="relative space-y-4 border-l border-border pl-5">
            {plan.milestones.map((m, i) => {
              const isDone = done.includes(i);
              return (
              <li key={i} className="relative">
                {projectId ? (
                  <button
                    onClick={() => toggle(i, !isDone)}
                    disabled={pending}
                    aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                    className={`absolute -left-[31px] top-0.5 flex size-5 items-center justify-center rounded-full border-2 transition ${
                      isDone
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-brand bg-card hover:bg-brand/10"
                    }`}
                  >
                    {isDone && <Check className="size-3" />}
                  </button>
                ) : (
                  <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-brand bg-card" />
                )}
                <div
                  className={`text-sm font-semibold ${isDone ? "text-muted line-through" : "text-brand"}`}
                >
                  {m.phase}
                </div>
                <div className={`text-sm ${isDone ? "text-muted" : ""}`}>{m.goal}</div>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {m.tasks.map((task, j) => (
                    <li
                      key={j}
                      className="rounded bg-background/60 px-2 py-0.5 text-xs text-muted"
                    >
                      {task}
                    </li>
                  ))}
                </ul>
                <div className="mt-1 text-xs text-muted">
                  <span className="font-medium text-foreground/80">Deliverable:</span>{" "}
                  {m.deliverable}
                </div>
              </li>
              );
            })}
          </ol>
        </Section>
      )}

      {/* APIs */}
      {plan.apis.length > 0 && (
        <Section icon={<Plug className="size-4 text-brand" />} title="APIs & services">
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.apis.map((a, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/40 p-3 text-sm">
                <span className="font-semibold">{a.name}</span>
                <span className="text-muted"> — {a.purpose}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Resources */}
      {(plan.repos.length > 0 || plan.datasets.length > 0 || plan.papers.length > 0) && (
        <Section icon={<GitBranch className="size-4 text-brand" />} title="Resources to build with">
          <div className="grid gap-4 sm:grid-cols-3">
            <ResourceList icon={<GitBranch className="size-3.5" />} title="Repositories" items={plan.repos} />
            <ResourceList icon={<Database className="size-3.5" />} title="Datasets" items={plan.datasets} />
            <ResourceList icon={<FileText className="size-3.5" />} title="Papers" items={plan.papers} />
          </div>
        </Section>
      )}

      {/* Knowledge clusters */}
      {plan.clusters.length > 0 && (
        <Section icon={<Boxes className="size-4 text-brand" />} title="Knowledge clusters">
          <div className="grid gap-3 sm:grid-cols-3">
            {plan.clusters.map((c, i) => (
              <div key={i} className="rounded-xl border border-border bg-background/40 p-4">
                <div className="font-semibold">{c.theme}</div>
                <p className="mt-1 text-xs text-muted">{c.summary}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {c.items.map((item, j) => (
                    <li key={j} className="flex gap-1.5">
                      <span className="text-brand">•</span>
                      <span className="text-foreground/90">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function ResourceList({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: Resource[];
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted/60">None found.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((r, i) => (
            <li key={i}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-baseline gap-1 text-sm text-foreground/90 hover:text-brand"
              >
                <span className="underline decoration-border underline-offset-2 group-hover:decoration-brand">
                  {r.title}
                </span>
                <ExternalLink className="size-3 shrink-0 self-center opacity-50" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
