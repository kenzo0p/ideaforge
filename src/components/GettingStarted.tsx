"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Sparkles, X } from "lucide-react";

export interface OnboardingProgress {
  validated: boolean;
  researched: boolean;
  planned: boolean;
  collaborated: boolean;
}

const STEPS: {
  key: keyof OnboardingProgress;
  title: string;
  body: string;
  href: string;
  cta: string;
}[] = [
  {
    key: "validated",
    title: "Validate an idea",
    body: "Type one line. You'll get a verdict and a severity score — including when an idea is weak.",
    href: "/",
    cta: "Start an idea",
  },
  {
    key: "researched",
    title: "Run DeepSearch",
    body: "Live web research with every claim linked to a real source, plus who's already built it.",
    href: "/",
    cta: "Open the console",
  },
  {
    key: "planned",
    title: "Generate a build plan",
    body: "Stack, architecture, milestones, and real repos, datasets and papers to build with.",
    href: "/",
    cta: "Generate a plan",
  },
  {
    key: "collaborated",
    title: "Bring in a teammate",
    body: "Invite by @username. They see it in their notifications — no email needed.",
    href: "/dashboard",
    cta: "Open a project",
  },
];

/**
 * First-run checklist, driven by what the account has actually done.
 *
 * Deliberately not a modal or a tour: those interrupt, get dismissed on reflex,
 * and teach nothing. This sits above the dashboard, ticks itself off as real
 * work happens, and disappears when finished.
 */
export default function GettingStarted({
  progress,
  onDismiss,
}: {
  progress: OnboardingProgress;
  onDismiss: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const done = STEPS.filter((s) => progress[s.key]).length;

  // Nothing left to teach.
  if (hidden || done === STEPS.length) return null;

  const next = STEPS.find((s) => !progress[s.key])!;

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-brand" /> Getting started
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {done} of {STEPS.length} done — takes about four minutes end to end.
          </p>
        </div>
        <button
          onClick={() => {
            setHidden(true);
            onDismiss();
          }}
          aria-label="Dismiss getting started"
          className="rounded-md p-1 text-muted transition hover:bg-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-4 h-1 rounded-full bg-surface">
        <div
          className="h-1 rounded-full bg-brand-solid transition-all"
          style={{ width: `${(done / STEPS.length) * 100}%` }}
        />
      </div>

      <ol className="space-y-2.5">
        {STEPS.map((s) => {
          const complete = progress[s.key];
          const isNext = s.key === next.key;
          return (
            <li key={s.key} className="flex items-start gap-2.5">
              {complete ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <Circle
                  className={`mt-0.5 size-4 shrink-0 ${isNext ? "text-brand" : "text-muted/50"}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm ${complete ? "text-muted line-through" : isNext ? "font-medium" : ""}`}
                >
                  {s.title}
                </p>
                {isNext && <p className="mt-0.5 text-xs text-muted">{s.body}</p>}
              </div>
              {isNext && (
                <Link
                  href={s.href}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-solid px-3 py-1.5 text-xs font-semibold text-on-brand transition hover:opacity-90"
                >
                  {s.cta} <ArrowRight className="size-3" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
