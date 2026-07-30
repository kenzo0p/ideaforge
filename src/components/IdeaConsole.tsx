"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Bookmark,
  Check,
  Languages,
  Lightbulb,
  Loader2,
  Rocket,
  Search,
  Sparkles,
  Square,
  Upload,
  type LucideIcon,
} from "lucide-react";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import DiscoverPanel from "@/components/DiscoverPanel";
import ResultTabs from "@/components/ResultTabs";
import ReviewPanel from "@/components/ReviewPanel";
import { USAGE_EVENT } from "@/components/UsageMeter";
import { saveProjectAction } from "@/lib/actions";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

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
type ResultTab = "validation" | "research" | "plan";
type ConsoleMode = "idea" | "discover" | "review";

export default function IdeaConsole({
  isAuthed = false,
  defaultLocale = "en",
  initialMode = "idea",
}: {
  isAuthed?: boolean;
  defaultLocale?: string;
  /** "discover" opens straight into problem discovery (via /?mode=discover). */
  initialMode?: ConsoleMode;
}) {
  const [idea, setIdea] = useState("");
  const [analyzedIdea, setAnalyzedIdea] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [provider, setProvider] = useState<string | null>(null);
  const [locale, setLocale] = useState(defaultLocale);
  const [mode, setMode] = useState<ConsoleMode>(initialMode);
  const [tab, setTab] = useState<ResultTab>("validation");
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
    setTab("validation"); // a new idea starts back at step one
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
      window.dispatchEvent(new Event(USAGE_EVENT));

      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
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
    setTab("research"); // follow the user to the step they just started
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: analyzedIdea, locale }),
      });
      setSearchProvider(res.headers.get("X-Search-Provider"));
      window.dispatchEvent(new Event(USAGE_EVENT));
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
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
    setTab("plan");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Enrich the plan with prior research when available.
        body: JSON.stringify({ idea: analyzedIdea, research: report ?? undefined, locale }),
      });
      setPlanProvider(res.headers.get("X-Provider"));
      window.dispatchEvent(new Event(USAGE_EVENT));
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
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
    // Saving requires an account — send guests to sign in.
    if (!isAuthed) {
      router.push("/sign-in");
      return;
    }
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

  const modeBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-brand-solid text-on-brand shadow-sm" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="w-full">
      {/* Mode toggle: bring your own idea, or discover a problem worth solving */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
        <button onClick={() => setMode("idea")} className={modeBtn(mode === "idea")}>
          <Sparkles className="size-4" /> I have an idea
        </button>
        <button onClick={() => setMode("discover")} className={modeBtn(mode === "discover")}>
          <Lightbulb className="size-4" /> Find a problem
        </button>
        <button onClick={() => setMode("review")} className={modeBtn(mode === "review")}>
          <Upload className="size-4" /> Review my deck
        </button>
      </div>

      {mode === "review" && <ReviewPanel locale={locale} />}

      {mode === "discover" && (
        <DiscoverPanel
          locale={locale}
          onForge={(starter) => {
            setMode("idea");
            analyze(starter);
          }}
        />
      )}

      {mode === "idea" && (
        <>
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
                className="rounded-md border border-border-strong bg-card px-1.5 py-0.5 text-xs outline-none focus:border-brand/60"
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-1.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-40"
            >
              Validate idea <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </form>

      {/* Results — one step per tab instead of one long stacked page */}
      {(output || streaming) && (
        <div className="mt-5 space-y-4">
          {provider && (
            <div className="flex justify-end text-xs">
              <span className="rounded-full border border-border px-2 py-0.5 text-muted">
                {provider}
              </span>
            </div>
          )}

          <ResultTabs
            active={tab}
            onChange={setTab}
            tabs={[
              {
                key: "validation",
                label: "Validation",
                icon: Sparkles,
                state: streaming ? "loading" : output ? "ready" : "empty",
              },
              {
                key: "research",
                label: "Research",
                icon: Search,
                state:
                  research === "loading" ? "loading" : research === "done" ? "ready" : "empty",
                locked: status !== "done",
              },
              {
                key: "plan",
                label: "Plan",
                icon: Rocket,
                state:
                  planStatus === "loading" ? "loading" : planStatus === "done" ? "ready" : "empty",
                locked: research !== "done",
              },
            ]}
          />

          {/* --- Validation tab --- */}
          {tab === "validation" && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className={`prose-insights text-[15px] ${streaming ? "caret" : ""}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
              </div>
              {status === "done" && research === "idle" && (
                <div className="mt-5 flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted">
                    <span className="font-medium text-foreground">Next →</span> back this up with
                    real research from across the web.
                  </p>
                  <button
                    onClick={runResearch}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-1.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
                  >
                    <Search className="size-4" /> Run DeepSearch
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- Research tab --- */}
          {tab === "research" && (
            <>
              {research === "idle" && (
                <EmptyStep
                  title="No research yet"
                  body="Search the live web and build a citation-backed briefing for this idea."
                  actionLabel="Run DeepSearch"
                  icon={Search}
                  onAction={runResearch}
                />
              )}
              {research === "loading" && (
                <LoadingStep text="Searching the web and synthesizing a citation-backed briefing…" />
              )}
              {research === "error" && <ErrorStep message={researchError} onRetry={runResearch} />}
              {research === "done" && report && (
                <ResearchPanel report={report} searchProvider={searchProvider} />
              )}
            </>
          )}

          {/* --- Plan tab --- */}
          {tab === "plan" && (
            <>
              {planStatus === "idle" && (
                <EmptyStep
                  title="No plan yet"
                  body="Turn the validation and research into a full, buildable project plan."
                  actionLabel="Generate Project Plan"
                  icon={Rocket}
                  onAction={generatePlan}
                />
              )}
              {planStatus === "loading" && (
                <LoadingStep text="Designing your architecture, roadmap, and resource recommendations…" />
              )}
              {planStatus === "error" && <ErrorStep message={planError} onRetry={generatePlan} />}
              {planStatus === "done" && plan && (
                <ProjectPlanPanel plan={plan} provider={planProvider} />
              )}
            </>
          )}
        </div>
      )}

      {/* Floating save bar — reachable from anywhere in a long result page */}
      {mode === "idea" && status === "done" && (
        <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-border bg-card/95 p-1.5 pl-3 shadow-lg backdrop-blur">
          <span className="hidden text-xs text-muted sm:inline">
            {savedId ? "Saved to dashboard" : "Don't lose this"}
          </span>
          {savedId && (
            <button
              onClick={() => router.push(`/projects/${savedId}`)}
              className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1.5 text-sm font-medium text-success transition hover:bg-success/20"
            >
              <Check className="size-4" /> Open
            </button>
          )}
          <button
            onClick={saveProject}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-solid px-4 py-1.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />}
            {!isAuthed ? "Sign in to save" : savedId ? "Update" : "Save"}
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// --- Shared step states (used by the Research and Plan tabs) ----------------

function EmptyStep({
  title,
  body,
  actionLabel,
  icon: Icon,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  icon: LucideIcon;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
      <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      <button
        onClick={onAction}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
      >
        <Icon className="size-4" /> {actionLabel}
      </button>
    </div>
  );
}

function LoadingStep({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
      <Loader2 className="size-4 animate-spin text-brand" />
      {text}
    </div>
  );
}

function ErrorStep({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger shadow-sm">
      ⚠️ {message}
      <button onClick={onRetry} className="ml-2 underline hover:no-underline">
        Retry
      </button>
    </div>
  );
}
