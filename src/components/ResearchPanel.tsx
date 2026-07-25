"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Lightbulb, Search, Swords } from "lucide-react";
import type { ResearchReport } from "@/lib/insights/types";

export default function ResearchPanel({
  report,
  searchProvider,
}: {
  report: ResearchReport;
  searchProvider: string | null;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Search className="size-4 text-brand" />
          DeepSearch — Research Briefing
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {report.demo && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-500">
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
        {report.queries.map((q) => (
          <span
            key={q}
            className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs text-brand"
          >
            {q}
          </span>
        ))}
      </div>

      {/* Summary */}
      <div className="prose-insights text-[15px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.summaryMarkdown}</ReactMarkdown>
      </div>

      {/* Existing solutions */}
      {report.existingSolutions.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Swords className="size-4 text-brand" /> Existing solutions
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {report.existingSolutions.map((s, i) => (
              <div key={i} className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {s.citations && s.citations.length > 0 && (
                    <span className="text-[10px] text-muted">[{s.citations.join(", ")}]</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">{s.what}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="mb-1 font-medium text-emerald-500">Strengths</div>
                    <ul className="space-y-0.5 text-muted">
                      {s.strengths.map((x, j) => (
                        <li key={j}>+ {x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-rose-500">Gaps</div>
                    <ul className="space-y-0.5 text-muted">
                      {s.gaps.map((x, j) => (
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
      {report.gaps.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="size-4 text-brand" /> Innovation opportunities
          </h3>
          <div className="space-y-2">
            {report.gaps.map((g, i) => (
              <div key={i} className="rounded-xl border border-border bg-background/40 p-4">
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
      {report.citations.length > 0 && (
        <section className="mt-6 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold">Sources</h3>
          <ol className="space-y-1.5 text-sm">
            {report.citations.map((c) => (
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
    </div>
  );
}
