"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Bookmark, Check, Languages, Loader2, Rocket, Search, Sparkles, Square } from "lucide-react";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import { saveProjectAction } from "@/lib/actions";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

const EXAMPLES = [
  "Build an AI solution to reduce food waste in college hostels.",
  "An app that helps first-gen students navigate scholarships.",
  "Use ML to detect crop disease from a phone photo.",
  "A tool that turns lecture recordings into structured notes.",
];

// Multilingual: BCP-47 locales the copilot can respond in.
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
];

type Status = "idle" | "streaming" | "done" | "error";
type ResearchStatus = "idle" | "loading" | "done" | "error";

export default function IdeaConsole() {
  const [idea, setIdea] = useState("");
  const [analyzedIdea, setAnalyzedIdea] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [provider, setProvider] = useState<string | null>(null);
  const [locale, setLocale] = useState("en");
  const abortRef = useRef<AbortController | null>(null);

  // DeepSearch (Part 2)
  const [research, setResearch] = useState<ResearchStatus>("idle");
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [searchProvider, setSearchProvider] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  // Project HUB (Part 3)
  const [planStatus, setPlanStatus] = useState<ResearchStatus>("idle");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [planProvider, setPlanProvider] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  // Persistence (Part 4)
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const router = useRouter();

  async function analyze(text: string) {
    const trimmed = text.trim();
    if (!trimmed || status === "streaming") return;

    setIdea(trimmed);
    setAnalyzedIdea(trimmed);
    setOutput("");
    setStatus("streaming");
    // Reset any prior research + plan when a new idea is analyzed.
    setResearch("idle");
    setReport(null);
    setResearchError(null);
    setPlanStatus("idle");
    setPlan(null);
    setPlanError(null);
    setSavedId(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: trimmed, locale }),
        signal: controller.signal,
      });
      setProvider(res.headers.get("X-Provider"));

      if (!res.ok || !res.body) {
        const { error } = await res.json().catch(() => ({ error: "Request failed." }));
        setOutput(`> ⚠️ ${error ?? "Request failed."}`);
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + decoder.decode(value, { stream: true }));
      }
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("done");
        return;
      }
      setOutput((prev) => prev + "\n\n> ⚠️ Something went wrong.");
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function runResearch() {
    if (!analyzedIdea || research === "loading") return;
    setResearch("loading");
    setResearchError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: analyzedIdea, locale }),
      });
      setSearchProvider(res.headers.get("X-Search-Provider"));
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Request failed." }));
        setResearchError(error ?? "DeepSearch failed.");
        setResearch("error");
        return;
      }
      setReport((await res.json()) as ResearchReport);
      setResearch("done");
    } catch {
      setResearchError("Something went wrong running DeepSearch.");
      setResearch("error");
    }
  }

  async function generatePlan() {
    if (!analyzedIdea || planStatus === "loading") return;
    setPlanStatus("loading");
    setPlanError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Enrich the plan with prior research when available.
        body: JSON.stringify({ idea: analyzedIdea, research: report ?? undefined, locale }),
      });
      setPlanProvider(res.headers.get("X-Provider"));
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Request failed." }));
        setPlanError(error ?? "Project HUB failed.");
        setPlanStatus("error");
        return;
      }
      setPlan((await res.json()) as ProjectPlan);
      setPlanStatus("done");
    } catch {
      setPlanError("Something went wrong generating the plan.");
      setPlanStatus("error");
    }
  }

  async function saveProject() {
    if (!analyzedIdea || saving) return;
    setSaving(true);
    try {
      const { id } = await saveProjectAction({
        id: savedId ?? undefined, // update in place if already saved
        title: analyzedIdea.slice(0, 70),
        idea: analyzedIdea,
        validationMarkdown: output || null,
        research: report ?? null,
        plan: plan ?? null,
      });
      setSavedId(id);
    } catch {
      // Non-fatal — user can retry.
    } finally {
      setSaving(false);
    }
  }

  const streaming = status === "streaming";

  return (
    <div className="w-full">
      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          analyze(idea);
        }}
        className="rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-brand/60 transition-colors"
      >
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              analyze(idea);
            }
          }}
          rows={3}
          placeholder="Describe an idea in one line — e.g. “Build an AI solution to reduce food waste in college hostels.”"
          className="w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted/70"
        />
        <div className="flex items-center justify-between px-2 pb-1">
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">⌘/Ctrl + Enter</span>
            <label className="inline-flex items-center gap-1 text-xs text-muted">
              <Languages className="size-3.5" />
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs outline-none focus:border-brand/60"
                aria-label="Output language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-1.5 text-sm font-medium hover:bg-foreground/15"
            >
              <Square className="size-3.5" /> Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!idea.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
            >
              Validate idea <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </form>

      {/* Example chips */}
      {status === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => analyze(ex)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* Result */}
      {(output || streaming) && (
        <div className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-brand" />
              Problem Validation
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              {status === "done" && savedId && (
                <button
                  onClick={() => router.push(`/projects/${savedId}`)}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-500"
                >
                  <Check className="size-3.5" /> Open project
                </button>
              )}
              {status === "done" && (
                <button
                  onClick={saveProject}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground transition hover:border-brand/50 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Bookmark className="size-3.5" />
                  )}
                  {savedId ? "Update" : "Save to dashboard"}
                </button>
              )}
              {streaming && <Loader2 className="size-3.5 animate-spin" />}
              {provider && (
                <span className="rounded-full border border-border px-2 py-0.5">{provider}</span>
              )}
            </div>
          </div>
          <div className={`prose-insights text-[15px] ${streaming ? "caret" : ""}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
          </div>
          {status === "done" && research === "idle" && (
            <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                <span className="font-medium text-foreground">Next →</span> back this up with
                real research from across the web.
              </p>
              <button
                onClick={runResearch}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                <Search className="size-4" /> Run DeepSearch
              </button>
            </div>
          )}
        </div>
      )}

      {/* DeepSearch loading / error / result */}
      {research === "loading" && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          Searching the web and synthesizing a citation-backed briefing…
        </div>
      )}
      {research === "error" && (
        <div className="mt-5 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-5 text-sm text-rose-500 shadow-sm">
          ⚠️ {researchError}
          <button onClick={runResearch} className="ml-2 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}
      {research === "done" && report && (
        <ResearchPanel report={report} searchProvider={searchProvider} />
      )}

      {/* Project HUB CTA — appears after research (which enriches the plan) */}
      {research === "done" && planStatus === "idle" && (
        <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">Next →</span> turn all of this into a
            full, buildable project plan.
          </p>
          <button
            onClick={generatePlan}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            <Rocket className="size-4" /> Generate Project Plan
          </button>
        </div>
      )}
      {planStatus === "loading" && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          Designing your architecture, roadmap, and resource recommendations…
        </div>
      )}
      {planStatus === "error" && (
        <div className="mt-5 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-5 text-sm text-rose-500 shadow-sm">
          ⚠️ {planError}
          <button onClick={generatePlan} className="ml-2 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}
      {planStatus === "done" && plan && <ProjectPlanPanel plan={plan} provider={planProvider} />}
    </div>
  );
}
