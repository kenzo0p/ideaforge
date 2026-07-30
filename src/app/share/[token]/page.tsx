import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Sparkles } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import { getProjectByShareToken } from "@/lib/db/projects";
import { buildMarkdownBrief } from "@/lib/export/brief";

export const dynamic = "force-dynamic";

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

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
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
    </div>
  );
}
