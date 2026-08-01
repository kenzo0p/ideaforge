"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Lightbulb, Search, Swords } from "lucide-react";
import type { ProjectPlan, ResearchReport, ResearchResources } from "@/lib/insights/types";
import ResourceAside from "@/components/ResourceAside";

/**
 * Resources moved from the build plan onto the research report. Projects saved
 * before that still carry them on the plan, so fall back rather than showing an
 * empty rail on older work.
 */
function resolveResources(
  report: ResearchReport,
  plan?: ProjectPlan | null,
): ResearchResources | null {
  if (report.resources) return report.resources;
  if (!plan) return null;
  const legacy = {
    papers: plan.papers ?? [],
    repos: plan.repos ?? [],
    datasets: plan.datasets ?? [],
    videos: [],
  };
  return legacy.papers.length || legacy.repos.length || legacy.datasets.length ? legacy : null;
}

export default function ResearchPanel({
  report,
  searchProvider,
  plan,
}: {
  report: ResearchReport;
  searchProvider: string | null;
  /** Only used to recover resources from projects saved before they moved. */
  plan?: ProjectPlan | null;
}) {
  const resources = resolveResources(report, plan);

  return (
    // Briefing on the left, resources rail on the right. One column until
    // there's room for two — the rail is unreadable squeezed onto a phone.
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Search className="size-4 text-brand" />
          DeepSearch — Research Briefing
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {report.demo && (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
              Demo data
            </span>
          )}
          {searchProvider && (
            <span className="rounded-full border border-border px-2 py-0.5">{searchProvider}</span>
          )}
        </div>
      </div>

      {/* Queries run */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Searched:</span>
        {(report.queries ?? []).map((q) => (
          <span
            key={q}
            className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs text-brand"
          >
            {q}
          </span>
        ))}
      </div>

      {/* Summary */}
      <div className="prose-insights max-w-[68ch] text-[15px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.summaryMarkdown}</ReactMarkdown>
      </div>

      {/* Existing solutions */}
      {(report.existingSolutions?.length ?? 0) > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Swords className="size-4 text-brand" /> Existing solutions
          </h3>
          <div className="grid gap-3 xl:grid-cols-2">
            {(report.existingSolutions ?? []).map((s, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {s.citations && s.citations.length > 0 && (
                    <span className="text-[10px] text-muted">[{s.citations.join(", ")}]</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">{s.what}</p>
                <div className="mt-3 space-y-2.5 text-xs">
                  <div>
                    <div className="mb-1 font-medium text-success">Strengths</div>
                    <ul className="space-y-0.5 text-muted">
                      {(s.strengths ?? []).map((x, j) => (
                        <li key={j}>+ {x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-danger">Gaps</div>
                    <ul className="space-y-0.5 text-muted">
                      {(s.gaps ?? []).map((x, j) => (
                        <li key={j}>− {x}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Innovation gaps */}
      {(report.gaps?.length ?? 0) > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="size-4 text-brand" /> Innovation opportunities
          </h3>
          <div className="space-y-2">
            {(report.gaps ?? []).map((g, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-4">
                <div className="font-semibold">{g.title}</div>
                <p className="mt-1 text-sm text-muted">{g.description}</p>
                <p className="mt-2 text-sm">
                  <span className="font-medium text-brand">Opportunity → </span>
                  <span className="text-foreground/90">{g.opportunity}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sources */}
      {(report.citations?.length ?? 0) > 0 && (
        <section className="mt-6 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold">Sources</h3>
          <ol className="space-y-1.5 text-sm">
            {(report.citations ?? []).map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className="shrink-0 text-muted">[{c.id}]</span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-baseline gap-1 text-foreground/90 hover:text-brand"
                >
                  <span className="underline decoration-border underline-offset-2 group-hover:decoration-brand">
                    {c.title}
                  </span>
                  <span className="text-xs text-muted">· {c.source}</span>
                  <ExternalLink className="size-3 shrink-0 self-center opacity-50" />
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      </section>

      {resources && <ResourceAside resources={resources} />}
    </div>
  );
}
