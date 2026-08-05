import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, Globe, Sparkles } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import { getProjectByShareToken } from "@/lib/db/projects";
import { buildMarkdownBrief } from "@/lib/export/brief";
import { publicUrl } from "@/lib/http/origin";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

export const dynamic = "force-dynamic";

/** One-line summary for search results and link previews. */
function summarise(idea: string): string {
  const clean = idea.replace(/\s+/g, " ").trim();
  return clean.length > 155 ? `${clean.slice(0, 152)}…` : clean;
}

/**
 * Per-brief metadata.
 *
 * The `robots` directive is the important part. A share link is unlisted by
 * default — people send them to a professor or a teammate — so an unlisted
 * brief is explicitly `noindex`. Only a brief whose owner opted in may enter a
 * search index, and only that one gets a canonical URL.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const project = await getProjectByShareToken(token);
  if (!project) return { title: "Brief not found — IdeaForge", robots: { index: false } };

  const description = summarise(project.idea);
  const url = await publicUrl(`/share/${token}`);

  return {
    title: `${project.title} — IdeaForge`,
    description,
    alternates: project.listed ? { canonical: url } : undefined,
    robots: project.listed
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      type: "article",
      title: project.title,
      description,
      url,
      siteName: "IdeaForge",
      publishedTime: new Date(project.createdAt).toISOString(),
      modifiedTime: new Date(project.updatedAt).toISOString(),
    },
    twitter: { card: "summary_large_image", title: project.title, description },
  };
}

// Public, read-only project brief. No auth: access is granted purely by holding
// the unguessable share token, which the owner can revoke at any time.
export default async function SharedBriefPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const project = await getProjectByShareToken(token);
  if (!project) notFound();

  const markdown = buildMarkdownBrief({
    title: project.title,
    idea: project.idea,
    createdAt: project.createdAt,
    validationMarkdown: project.validationMarkdown,
    research: project.research,
    plan: project.plan,
  });

  if (project.listed) void track(EVENTS.PUBLIC_BRIEF_VIEWED);

  // Structured data, so a result can render as a real article rather than a
  // bare blue link. Listed briefs only: there's no point handing a crawler a
  // richer description of a page it has been told not to index.
  const jsonLd = project.listed
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: project.title,
        description: summarise(project.idea),
        datePublished: new Date(project.createdAt).toISOString(),
        dateModified: new Date(project.updatedAt).toISOString(),
        url: await publicUrl(`/share/${token}`),
        publisher: { "@type": "Organization", name: "IdeaForge" },
      }
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs text-muted">
          <Globe className="size-3.5 text-brand" />
          Shared read-only brief
        </span>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        >
          <Sparkles className="size-4" /> Built with IdeaForge
        </Link>
      </div>

      <article className="prose-insights text-[15px]">
        <MarkdownView>{markdown}</MarkdownView>
      </article>

      {/* Someone who read a whole brief is the warmest visitor this app gets:
          they arrived from a search result and stayed. The ask belongs here,
          not in a banner they scrolled past on the way in. */}
      <aside className="mt-10 rounded-2xl border border-brand/40 bg-brand/5 p-6 text-center">
        <h2 className="text-lg font-semibold">Have an idea of your own?</h2>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted">
          IdeaForge turns one line into this: a validated problem, citation-backed research,
          and a build plan. Free to try, no card.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
        >
          <Sparkles className="size-4" /> Validate my idea
          <ArrowRight className="size-3.5" />
        </Link>
        {project.listed && (
          <p className="mt-3 text-xs text-muted">
            <Link href="/explore" className="underline hover:text-foreground">
              Browse other public briefs
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}
