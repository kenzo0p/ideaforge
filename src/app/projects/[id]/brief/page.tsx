import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import PrintTrigger from "@/components/PrintTrigger";
import { getProject } from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { buildMarkdownBrief } from "@/lib/export/brief";

export const dynamic = "force-dynamic";

// Print-optimized brief. Opening this page triggers the browser print dialog,
// where "Save as PDF" produces the PDF deliverable (no headless-browser dep).
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const project = await getProject(id, user.id);
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
    <div className="print-page mx-auto w-full max-w-3xl px-6 py-8">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to project
        </Link>
        <PrintTrigger />
      </div>

      <article className="prose-insights print-body text-[15px]">
        <MarkdownView>{markdown}</MarkdownView>
      </article>
    </div>
  );
}
