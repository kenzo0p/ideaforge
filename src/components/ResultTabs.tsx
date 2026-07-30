"use client";

import type { LucideIcon } from "lucide-react";
import { Check, Loader2, Lock } from "lucide-react";

export type TabState = "empty" | "loading" | "ready";

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon: LucideIcon;
  state: TabState;
  /** Locked tabs are visible but not selectable (a prerequisite is missing). */
  locked?: boolean;
}

/**
 * Segmented tab bar for the copilot's outputs. Each tab advertises its own
 * status (empty / running / ready) so the whole pipeline is legible at a glance
 * instead of scrolling one long stacked page.
 */
export default function ResultTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<TabDef<K>>;
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            disabled={t.locked}
            onClick={() => !t.locked && onChange(t.key)}
            title={t.locked ? "Complete the previous step first" : t.label}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-brand-solid text-on-brand shadow-sm"
                : t.locked
                  ? "cursor-not-allowed text-muted/50"
                  : "text-muted hover:bg-hover hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{t.label}</span>

            {/* Status affordance */}
            {t.state === "loading" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : t.state === "ready" ? (
              <Check
                className={`size-3.5 shrink-0 ${isActive ? "text-on-brand/80" : "text-success"}`}
              />
            ) : t.locked ? (
              <Lock className="size-3 shrink-0" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
