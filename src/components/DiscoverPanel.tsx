"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Compass, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { USAGE_EVENT } from "@/components/UsageMeter";
import type { ProblemDiscovery } from "@/lib/pipeline/types";

const SUGGESTIONS = ["Student life", "Climate", "Rural healthcare", "Personal finance", "Mental health"];

type Status = "idle" | "loading" | "done" | "error";

// Problem Discovery: help users FIND a real-world problem worth solving, then
// hand the chosen starter idea back to the console via onScrutinise().
export default function DiscoverPanel({
  onScrutinise,
  locale,
}: {
  onScrutinise: (idea: string) => void;
  locale: string;
}) {
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ProblemDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function discover(d: string) {
    if (status === "loading") return;
    setDomain(d);
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d, locale }),
      });
      window.dispatchEvent(new Event(USAGE_EVENT));
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Request failed." }));
        setError(error ?? "Discovery failed.");
        setStatus("error");
        return;
      }
      setResult((await res.json()) as ProblemDiscovery);
      setStatus("done");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="w-full">
      {/* Domain composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          discover(domain);
        }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <label className="mb-1 block text-sm font-medium">
          What area do you want to explore?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. rural healthcare, student productivity… (or leave blank)"
            className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand/60"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {status === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Compass className="size-4" />
            )}
            Discover problems
          </button>
        </div>
        {status === "idle" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => discover(s)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {status === "loading" && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          Scanning current signals for real problems worth solving…
        </div>
      )}
      {status === "error" && (
        <div className="mt-5 rounded-2xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger shadow-sm">
          ⚠️ {error}
        </div>
      )}

      {status === "done" && result && (
        <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Compass className="size-4 text-brand" />
              Problems worth solving{result.domain !== "general" ? ` in ${result.domain}` : ""}
            </div>
            {result.demo && (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                Demo data
              </span>
            )}
          </div>

          {result.problems.length === 0 ? (
            <p className="text-sm text-muted">No problems surfaced — try a different area.</p>
          ) : (
            <div className="space-y-3">
              {result.problems.map((p, i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-4">
                  <div className="font-semibold">{p.title}</div>
                  <p className="mt-1 text-sm text-muted">{p.description}</p>
                  <div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground/80">Who:</span> {p.whoIsAffected}
                    </div>
                    <div>
                      <span className="font-medium text-foreground/80">Why now:</span> {p.whyNow}
                    </div>
                  </div>
                  {p.signals?.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {p.signals.map((s, j) => (
                        <li key={j} className="rounded bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm">
                      <span className="font-medium text-brand">Starter idea → </span>
                      <span className="text-foreground/90">{p.starterIdea}</span>
                    </p>
                    <button
                      onClick={() => onScrutinise(p.starterIdea)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-3 py-1.5 text-xs font-semibold text-on-brand transition hover:opacity-90"
                    >
                      <Sparkles className="size-3.5" /> Scrutinise this idea <ArrowRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.sources.length > 0 && (
            <section className="mt-5 border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-semibold">Signals from</h3>
              <ol className="space-y-1.5 text-sm">
                {result.sources.map((c) => (
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
      )}
    </div>
  );
}
