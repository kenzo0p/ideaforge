import Link from "next/link";
import { LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";

// Global top nav. Server component — reads the session to show auth state.
export default async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Sparkles className="size-4 text-brand" />
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            IdeaForge
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-muted transition hover:bg-card hover:text-foreground"
          >
            New idea
          </Link>
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted transition hover:bg-card hover:text-foreground"
              >
                <LayoutDashboard className="size-4" />
                Dashboard
              </Link>
              <span className="ml-1 hidden max-w-[14ch] truncate text-xs text-muted sm:inline" title={user.email}>
                {user.email}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted transition hover:bg-card hover:text-foreground"
                >
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="rounded-lg px-3 py-1.5 text-muted transition hover:bg-card hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg bg-brand-solid px-3 py-1.5 font-semibold text-on-brand transition hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
