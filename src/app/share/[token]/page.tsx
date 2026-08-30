import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, Globe, Sparkles } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import GroundingBadge from "@/components/GroundingBadge";
import GroundingProof from "@/components/GroundingProof";
import ClaimList, { ClaimBadge } from "@/components/ClaimList";
import { getProjectByShareToken, isPubliclyListed } from "@/lib/db/projects";
import { getGrounding } from "@/lib/db/grounding";
import { getClaims } from "@/lib/db/claims";
import { claimSentence, groundingSentence } from "@/lib/verify/score";
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
  if (!project) return { title: "Brief not found — Scrutan", robots: { index: false } };

  const url = await publicUrl(`/share/${token}`);
  const indexable = isPubliclyListed(project);

  // The verification result belongs in the preview text, not only on the page.
  // A link posted to a group chat is judged before it is opened, and "9 of 10
  // sources verified" is the only part of this brief a stranger can check.
  const [grounding, claims] = await Promise.all([
    getGrounding(project.id),
    getClaims(project.id),
  ]);
  // Claim support outranks citation grounding in the preview: "9 of 12 claims
  // are stated by their source" is a stronger and rarer thing to be able to say
  // than "the links resolve".
  const description = claims
    ? `${claimSentence(claims)} ${summarise(project.idea)}`.slice(0, 200)
    : grounding
    ? `${groundingSentence(grounding)} ${summarise(project.idea)}`.slice(0, 200)
    : summarise(project.idea);

  return {
    title: `${project.title} — Scrutan`,
    description,
    alternates: indexable ? { canonical: url } : undefined,
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      type: "article",
      title: project.title,
      description,
      url,
      siteName: "Scrutan",
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

  const indexable = isPubliclyListed(project);
  if (indexable) void track(EVENTS.PUBLIC_BRIEF_VIEWED);

  const [grounding, claims] = await Promise.all([
    getGrounding(project.id),
    getClaims(project.id),
  ]);

  // Structured data, so a result can render as a real article rather than a
  // bare blue link. Listed briefs only: there's no point handing a crawler a
  // richer description of a page it has been told not to index.
  const jsonLd = indexable
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: project.title,
        description: summarise(project.idea),
        datePublished: new Date(project.createdAt).toISOString(),
        dateModified: new Date(project.updatedAt).toISOString(),
        url: await publicUrl(`/share/${token}`),
        publisher: { "@type": "Organization", name: "Scrutan" },
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
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            <Globe className="size-3.5 text-brand" />
            Shared read-only brief
          </span>
          {grounding && grounding.verdicts.length > 0 && (
            <GroundingBadge
              score={grounding.groundingScore}
              verified={grounding.verified}
              total={grounding.verdicts.length}
            />
          )}
          {claims && claims.verdicts.length > 0 && <ClaimBadge report={claims} />}
        </span>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        >
          <Sparkles className="size-4" /> Built with Scrutan
        </Link>
      </div>

      <article className="prose-brief text-[15px]">
        <MarkdownView>{markdown}</MarkdownView>
      </article>

      {/* The evidence, after the argument it supports. Someone who has just
          read a claim is the reader most interested in whether its source
          exists — and putting it here rather than at the top means the brief
          is not asking for trust before it has said anything. */}
      {grounding && (
        <div className="mt-8">
          <GroundingProof report={grounding} />
        </div>
      )}

      {/* Read-only for the same reason the citation check is: reading every
          cited page is a burst of outbound requests, and a public page that
          lets any visitor trigger one is a request amplifier aimed at other
          people's servers. Visitors see the owner's last result. */}
      {claims && claims.verdicts.length > 0 && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Claim check</h2>
            <ClaimBadge report={claims} />
          </div>
          <p className="mt-1.5 max-w-prose text-xs text-muted">
            {claimSentence(claims)} Each claim below is shown with the passage from its cited
            source that states it — or with the fact that no such passage exists.
          </p>
          <ClaimList report={claims} />
        </section>
      )}

      {/* Someone who read a whole brief is the warmest visitor this app gets:
          they arrived from a search result and stayed. The ask belongs here,
          not in a banner they scrolled past on the way in. */}
      <aside className="mt-10 rounded-2xl border border-brand/40 bg-brand/5 p-6 text-center">
        <h2 className="text-lg font-semibold">Have an idea of your own?</h2>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted">
          Scrutan turns one line into this: a validated problem, citation-backed research,
          and a build plan. Free to try, no card.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
        >
          <Sparkles className="size-4" /> Validate my idea
          <ArrowRight className="size-3.5" />
        </Link>
        {indexable && (
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
