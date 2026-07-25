import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import Workspace from "@/components/Workspace";
import AgentConsole from "@/components/AgentConsole";
import { getProject, listWorkspaceItems } from "@/lib/db/projects";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  const items = listWorkspaceItems(id);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold leading-tight">{project.title}</h1>
        <p className="mt-1 text-sm text-muted">{project.idea}</p>
        <p className="mt-2 text-xs text-muted">Updated {timeAgo(project.updatedAt)}</p>
      </header>

      <div className="space-y-5">
        {/* Saved Problem Validation */}
        {project.validationMarkdown && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-3 text-sm font-semibold">
              <Sparkles className="size-4 text-brand" />
              Problem Validation
            </div>
            <MarkdownView>{project.validationMarkdown}</MarkdownView>
          </div>
        )}

        {/* Saved DeepSearch */}
        {project.research && <ResearchPanel report={project.research} searchProvider="Saved" />}

        {/* Saved Project HUB plan */}
        {project.plan && <ProjectPlanPanel plan={project.plan} provider="Saved" />}

        {/* AI Agent */}
        <AgentConsole projectId={project.id} />

        {/* Research Workspace */}
        <Workspace projectId={project.id} items={items} />
      </div>
    </main>
  );
}
