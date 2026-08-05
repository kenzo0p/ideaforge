import Link from "next/link";
import type { Metadata } from "next";
import { Compass, FileText, Rocket, Search, Sparkles } from "lucide-react";
import { listPublicBriefs } from "@/lib/db/projects";
import { publicUrl } from "@/lib/http/origin";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const url = await publicUrl("/explore");
  const description =
    "Public project briefs from IdeaForge — validated problems, citation-backed research, and build plans, published by the people who made them.";
  return {
    title: "Explore public briefs — IdeaForge",
    description,
    alternates: { canonical: url },
    openGraph: { title: "Explore public briefs", description, url, siteName: "IdeaForge" },
  };
}

/**
 * The public directory.
 *
 * Two jobs, and the second is the reason it exists: it gives visitors something
 * to browse, and it gives a crawler a single page that links to every listed
 * brief. Without it each brief is an island reachable only by someone who
 * already has the link, which is the opposite of an acquisition channel.
 */
export default async function ExplorePage() {
  const briefs = await listPublicBriefs();

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Compass className="size-6 text-brand" />
        Explore public briefs
      </h1>
      <p className="mb-8 max-w-prose text-sm text-muted">
        Real projects, published by the people who built them: a validated problem, the
        research behind it, and the plan to ship it.
      </p>

      {briefs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Search className="mx-auto mb-3 size-6 text-muted" />
          <p className="text-sm text-muted">
            Nothing published yet. Validate an idea and you could be the first.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
          >
            <Sparkles className="size-4" /> Start an idea
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {briefs.map((b) => (
            <li key={b.token}>
              <Link
                href={`/share/${b.token}`}
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition hover:border-brand/50"
              >
                <h2 className="text-sm font-semibold group-hover:text-brand">{b.title}</h2>
                <p className="mt-1 line-clamp-3 flex-1 text-xs text-muted">{b.idea}</p>
                <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  {b.hasResearch && (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="size-3 text-brand" /> researched
                    </span>
                  )}
                  {b.hasPlan && (
                    <span className="inline-flex items-center gap-1">
                      <Rocket className="size-3 text-brand" /> has a plan
                    </span>
                  )}
                  <span className="ml-auto">{timeAgo(b.listedAt)}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
