import Link from "next/link";
import IdeaConsole from "@/components/IdeaConsole";
import SignInGate from "@/components/SignInGate";
import { CAPABILITIES } from "@/lib/pipeline/capabilities";
import { getPipeline } from "@/lib/pipeline";
import { getProvider } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const live = getPipeline().capabilities;
  const user = await getCurrentUser();
  const isAuthed = !!user;
  const isDemo = getProvider().isMock;
  // `/?mode=discover` opens straight into problem discovery.
  const initialMode = (await searchParams).mode === "discover" ? "discover" : "idea";

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:py-16">
      {/* Header */}
      <header className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted">
          <span className="size-1.5 rounded-full bg-success" />
          Every cited source is fetched and checked
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            Scrutan
          </span>
        </h1>
        <p className="mt-2 text-lg font-medium text-foreground/80">Proof before you build.</p>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Most AI tools will happily tell you your idea is brilliant. Scrutan scrutinises it:
          it scores how real the problem is, researches it against live sources, then{" "}
          <strong className="font-semibold text-foreground/90">opens every citation to
          confirm the source exists and says what it was cited for</strong> — and tells you
          when the answer is that your idea isn&apos;t worth building.
        </p>
      </header>

      {/* Demo-mode banner — honest signal that no LLM is connected yet. */}
      {isAuthed && isDemo && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning dark:text-warning">
          <span className="font-semibold">⚠️ Demo mode —</span> no language model is connected, so
          analysis, plans, and clusters are <strong>generic templates, not tailored to your idea</strong>.
          Web search, GitHub, datasets, and papers are live. Add an{" "}
          <code className="rounded bg-warning/20 px-1">OPENAI_API_KEY</code> or{" "}
          <code className="rounded bg-warning/20 px-1">ANTHROPIC_API_KEY</code> to go fully live.
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

      {/* What it does. Everything here is shipped — this is not a roadmap. */}
      <section className="mt-14">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
          What Scrutan does
        </h2>
        <p className="mb-5 text-sm text-muted">
          From a one-line idea to a checked, buildable brief.
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
                  {!isLive && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      Off
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted">{cap.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="mt-14 border-t border-border pt-6 text-center text-xs text-muted">
        Scrutan · An idea is only as good as the evidence behind it.{" "}
        {/* The hero makes a claim about quality. This is where it is checked —
            a claim of this kind with nowhere to verify it would be the exact
            thing the rest of the page argues against. */}
        <Link href="/quality" className="underline hover:text-foreground">
          See how well it actually works
        </Link>
        .
      </footer>
    </main>
  );
}
