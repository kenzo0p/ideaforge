import Link from "next/link";
import { LayoutDashboard, Sparkles } from "lucide-react";

// Global top nav. Server component — no interactivity beyond links.
export default function SiteHeader() {
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
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted transition hover:bg-card hover:text-foreground"
          >
            <LayoutDashboard className="size-4" />
            Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}
