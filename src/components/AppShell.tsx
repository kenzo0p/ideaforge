"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  Bot,
  Compass,
  FileText,
  FolderKanban,
  Rocket,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import CommandPalette, { PALETTE_EVENT } from "@/components/CommandPalette";
import UsageMeter from "@/components/UsageMeter";
import { signOutAction } from "@/lib/auth/actions";

interface AppUser {
  email: string;
}

interface RecentProject {
  id: string;
  title: string;
}

// Nested sections shown under the project you're currently viewing.
const PROJECT_SECTIONS = [
  { key: "validation", label: "Validation", icon: Sparkles },
  { key: "research", label: "Research", icon: Search },
  { key: "plan", label: "Plan", icon: Rocket },
  { key: "workspace", label: "Workspace", icon: FolderKanban },
  { key: "collaborate", label: "Collaborate", icon: Bot },
] as const;

const NAV = [
  { href: "/", label: "New idea", icon: Sparkles, authOnly: false },
  { href: "/?mode=discover", label: "Find a problem", icon: Compass, authOnly: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, authOnly: true },
  { href: "/notifications", label: "Notifications", icon: Bell, authOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, authOnly: true },
];

export default function AppShell({
  user,
  projects = [],
  unreadCount = 0,
  initialTheme = "system",
  initialCollapsed = false,
  children,
}: {
  user: AppUser | null;
  projects?: RecentProject[];
  unreadCount?: number;
  /** Read from cookies on the server so there's no flash or layout shift. */
  initialTheme?: "light" | "dark" | "system";
  initialCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const recentProjects = projects.slice(0, 6);

  // "/" and "/?mode=discover" share a pathname, so compare the mode too.
  const currentMode = searchParams.get("mode");
  const currentTab = searchParams.get("tab");
  const isNavActive = (href: string) => {
    if (!href.startsWith("/?")) return pathname === href;
    return pathname === "/" && currentMode === "discover";
  };

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      document.cookie = `sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  /** `mini` renders the icon-only rail (desktop collapsed state). */
  const sidebarContent = (mini: boolean) => (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className={`mb-4 flex items-center ${mini ? "justify-center" : "justify-between"}`}>
        <Link href="/" className="flex items-center gap-2 px-1 py-1.5" title="IdeaForge">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-solid to-brand-2-solid text-on-brand">
            <Sparkles className="size-4" />
          </span>
          {!mini && <span className="text-lg font-bold">IdeaForge</span>}
        </Link>
        {!mini && (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            className="hidden rounded-lg p-1.5 text-muted transition hover:bg-hover hover:text-foreground lg:block"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {mini && (
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          className="mb-1 flex justify-center rounded-lg p-2 text-muted transition hover:bg-hover hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {/* Command palette trigger */}
      <button
        onClick={() => window.dispatchEvent(new Event(PALETTE_EVENT))}
        title="Search (⌘K)"
        className={`mb-2 flex items-center gap-2 rounded-lg border border-border bg-background text-sm text-muted transition hover:border-brand/40 hover:text-foreground ${
          mini ? "justify-center px-2 py-2" : "w-full px-3 py-2"
        }`}
      >
        <Search className="size-4 shrink-0" />
        {!mini && (
          <>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">⌘K</kbd>
          </>
        )}
      </button>

      <nav className="flex flex-col gap-0.5">
        {NAV.filter((n) => !n.authOnly || user).map((n) => {
          // "New idea" shouldn't stay lit while discovery mode is open.
          const active =
            n.href === "/" ? pathname === "/" && currentMode !== "discover" : isNavActive(n.href);
          const showBadge = n.href === "/notifications" && unreadCount > 0;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              onClick={() => setOpen(false)}
              className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                mini ? "justify-center" : ""
              } ${
                active
                  ? "bg-brand/10 text-brand"
                  : "text-muted hover:bg-hover hover:text-foreground"
              }`}
            >
              <span className="relative shrink-0">
                <n.icon className="size-4" />
                {showBadge && mini && (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-brand-solid" />
                )}
              </span>
              {!mini && (
                <>
                  <span className="flex-1">{n.label}</span>
                  {showBadge && (
                    <span className="rounded-full bg-brand-solid px-1.5 py-0.5 text-[10px] font-semibold text-on-brand">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Recent projects — quick nav (hidden on the mini rail) */}
      {user && !mini && recentProjects.length > 0 && (
        <div className="mt-4 overflow-y-auto">
          <div className="mb-1 flex items-center justify-between px-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Recent
            </span>
            <Link href="/dashboard" className="text-[10px] text-muted hover:text-foreground">
              All
            </Link>
          </div>
          <div className="flex flex-col gap-0.5">
            {recentProjects.map((p) => {
              const active = pathname === `/projects/${p.id}`;
              return (
                <div key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    title={p.title}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-brand/10 text-brand"
                        : "text-muted hover:bg-hover hover:text-foreground"
                    }`}
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{p.title}</span>
                  </Link>

                  {/* Nested section links for the project you're viewing */}
                  {active && (
                    <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2.5">
                      {PROJECT_SECTIONS.map((s) => {
                        const isCurrent = (currentTab ?? "validation") === s.key;
                        return (
                          <Link
                            key={s.key}
                            href={`/projects/${p.id}?tab=${s.key}`}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs transition ${
                              isCurrent
                                ? "bg-brand/10 font-medium text-brand"
                                : "text-muted hover:bg-hover hover:text-foreground"
                            }`}
                          >
                            <s.icon className="size-3 shrink-0" />
                            {s.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-2">
        {user && !mini && <UsageMeter />}
        <ThemeToggle collapsed={mini} initialTheme={initialTheme} />
        {user ? (
          mini ? (
            <form action={signOutAction}>
              <button
                type="submit"
                title={`Sign out (${user.email})`}
                className="flex w-full justify-center rounded-lg p-2 text-muted transition hover:bg-hover hover:text-danger"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          ) : (
            <div className="rounded-lg px-3 py-2">
              <p className="truncate text-xs text-muted" title={user.email}>
                {user.email}
              </p>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-danger"
                >
                  <LogOut className="size-4" /> Sign out
                </button>
              </form>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1">
            <Link
              href="/sign-in"
              title="Sign in"
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-hover hover:text-foreground ${
                mini ? "justify-center" : ""
              }`}
            >
              <LogIn className="size-4 shrink-0" />
              {!mini && "Sign in"}
            </Link>
            <Link
              href="/sign-up"
              title="Sign up"
              className={`flex items-center justify-center gap-1.5 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90`}
            >
              <UserPlus className="size-4 shrink-0" />
              {!mini && "Sign up"}
            </Link>
          </div>
        )}
      </div>
    </div>
  );

  const railWidth = collapsed ? "w-16" : "w-60";
  const contentPad = collapsed ? "lg:pl-16" : "lg:pl-60";

  return (
    <div className="min-h-full">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-border bg-sidebar transition-all duration-200 lg:block ${railWidth}`}
      >
        {sidebarContent(collapsed)}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-sidebar/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-solid to-brand-2-solid text-on-brand">
            <Sparkles className="size-3.5" />
          </span>
          IdeaForge
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="relative rounded-lg p-1.5 text-muted hover:text-foreground"
        >
          <Menu className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 size-2 rounded-full bg-brand-solid" />
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-sidebar">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
            {sidebarContent(false)}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className={`${contentPad} transition-all duration-200`}>{children}</div>

      {/* ⌘K command palette (global) */}
      {user && <CommandPalette projects={projects} />}
    </div>
  );
}
