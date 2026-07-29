import IdeaConsole from "@/components/IdeaConsole";
import SignInGate from "@/components/SignInGate";
import { CAPABILITIES } from "@/lib/insights/capabilities";
import { getLayer2 } from "@/lib/insights/layer2";
import { getProvider } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const live = getLayer2().capabilities;
  const user = await getCurrentUser();
  const isAuthed = !!user;
  const isDemo = getProvider().isMock;
  // `/?mode=discover` opens straight into problem discovery.
  const initialMode = (await searchParams).mode === "discover" ? "discover" : "idea";

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-16">
      {/* Header */}
      <header className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted">
          <span className="size-1.5 rounded-full bg-accent" />
          Powered by iNSIGHTS Layer 2
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            IdeaForge
          </span>
        </h1>
        <p className="mt-2 text-lg font-medium text-foreground/80">Search Less. Solve More.</p>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Your AI research &amp; innovation copilot. Drop in a one-line idea and go from
          problem discovery to a validated, buildable project — with citation-backed research,
          an auto-generated plan, and the resources to ship it.
        </p>
      </header>

      {/* Demo-mode banner — honest signal that no LLM is connected yet. */}
      {isAuthed && isDemo && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <span className="font-semibold">⚠️ Demo mode —</span> no language model is connected, so
          analysis, plans, and clusters are <strong>generic templates, not tailored to your idea</strong>.
          Web search, GitHub, datasets, and papers are live. Add an{" "}
          <code className="rounded bg-amber-500/20 px-1">OPENAI_API_KEY</code> or{" "}
          <code className="rounded bg-amber-500/20 px-1">ANTHROPIC_API_KEY</code> to go fully live.
        </div>
      )}

      {/* Console — gated behind auth */}
      {isAuthed ? (
        <IdeaConsole
          isAuthed
          defaultLocale={user?.locale ?? "en"}
          initialMode={initialMode}
        />
      ) : (
        <SignInGate />
      )}

      {/* Capability roadmap */}
      <section className="mt-14">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          iNSIGHTS Layer 2 capabilities
        </h2>
        <p className="mb-5 text-sm text-muted">
          Problem validation is live. Here&apos;s the full copilot taking shape.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => {
            const isLive = live[cap.id];
            const Icon = cap.icon;
            return (
              <div
                key={cap.id}
                className="rounded-xl border border-border bg-card p-4 transition hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 font-semibold">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Icon className="size-4" />
                    </span>
                    {cap.title}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      isLive ? "bg-accent/15 text-accent" : "border border-border text-muted"
                    }`}
                  >
                    {isLive ? "Live" : `Part ${cap.part}`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{cap.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="mt-14 border-t border-border pt-6 text-center text-xs text-muted">
        IdeaForge · iNSIGHTS Track · built in parts — Part 1: foundation &amp; problem validation
      </footer>
    </main>
  );
}
