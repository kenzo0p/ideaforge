import IdeaConsole from "@/components/IdeaConsole";
import { CAPABILITIES } from "@/lib/insights/capabilities";
import { getLayer2 } from "@/lib/insights/layer2";

export default function Home() {
  const live = getLayer2().capabilities;

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

      {/* Console */}
      <IdeaConsole />

      {/* Capability roadmap */}
      <section className="mt-14">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          iNSIGHTS Layer 2 capabilities
        </h2>
        <p className="mb-5 text-sm text-muted">
          Problem validation is live. Here&apos;s the full copilot taking shape.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((cap) => {
            const isLive = live[cap.id];
            return (
              <div
                key={cap.id}
                className="rounded-xl border border-border bg-card p-4 transition hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="text-lg">{cap.icon}</span>
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
