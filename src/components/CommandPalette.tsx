"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Compass,
  CornerDownLeft,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Search,
  Settings,
  SunMoon,
} from "lucide-react";

interface PaletteProject {
  id: string;
  title: string;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  group: "Actions" | "Projects";
}

/** Dispatch to open the palette from a button. */
export const PALETTE_EVENT = "ideaforge:palette";

// ⌘K / Ctrl-K command palette: jump to a project or run a quick action.
export default function CommandPalette({ projects }: { projects: PaletteProject[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening always starts from a clean slate (the input autofocuses on mount).
  const openPalette = useCallback(() => {
    setQuery("");
    setIndex(0);
    setOpen(true);
  }, []);

  // Global hotkey + programmatic open from the sidebar button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (v) return false;
          setQuery("");
          setIndex(0);
          return true;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, openPalette);
    };
  }, [openPalette]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const actions: Command[] = [
      { id: "new", label: "New idea", hint: "Validate an idea", icon: Compass, run: go("/"), group: "Actions" },
      {
        id: "discover",
        label: "Find a problem",
        hint: "Problem discovery",
        icon: Lightbulb,
        run: () => {
          setOpen(false);
          router.push("/?mode=discover");
        },
        group: "Actions",
      },
      { id: "dash", label: "Dashboard", hint: "All projects", icon: LayoutDashboard, run: go("/dashboard"), group: "Actions" },
      { id: "notifs", label: "Notifications", hint: "Agent nudges", icon: Bell, run: go("/notifications"), group: "Actions" },
      { id: "settings", label: "Settings", hint: "Profile & security", icon: Settings, run: go("/settings"), group: "Actions" },
      {
        id: "theme",
        label: "Toggle theme",
        hint: "Light / dark",
        // Static icon: this list is built during SSR, where `document` is absent.
        icon: SunMoon,
        run: () => {
          const root = document.documentElement;
          const dark = !root.classList.contains("dark");
          root.classList.remove("light", "dark");
          root.classList.add(dark ? "dark" : "light");
          document.cookie = `theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
          setOpen(false);
        },
        group: "Actions",
      },
    ];
    const projectCmds: Command[] = projects.map((p) => ({
      id: p.id,
      label: p.title,
      icon: FileText,
      run: go(`/projects/${p.id}`),
      group: "Projects",
    }));
    return [...actions, ...projectCmds];
  }, [projects, router]);

  // Simple subsequence match — forgiving without a fuzzy-search dependency.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ""}`.toLowerCase();
      let i = 0;
      for (const ch of q) {
        i = hay.indexOf(ch, i);
        if (i === -1) return false;
        i++;
      }
      return true;
    });
  }, [commands, query]);

  if (!open) return null;

  const groups: Array<Command["group"]> = ["Actions", "Projects"];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0); // keep the highlight on the top match
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                results[index]?.run();
              }
            }}
            placeholder="Search projects or run a command…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted/70"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">No matches.</p>
          ) : (
            groups.map((group) => {
              const items = results.filter((r) => r.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {group}
                  </div>
                  {items.map((c) => {
                    const active = results.indexOf(c) === index;
                    return (
                      <button
                        key={c.id}
                        onMouseEnter={() => setIndex(results.indexOf(c))}
                        onClick={c.run}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                          active ? "bg-brand/10 text-brand" : "text-foreground/90 hover:bg-background"
                        }`}
                      >
                        <c.icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{c.label}</span>
                        {c.hint && <span className="text-xs text-muted">{c.hint}</span>}
                        {active && <CornerDownLeft className="size-3.5 shrink-0 opacity-60" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
