import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getProjectForViewer } from "@/lib/db/projects";
import { listComments } from "@/lib/db/collaboration";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { timeAgo } from "@/lib/format";
import MarkdownView from "@/components/MarkdownView";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import CommentThread from "@/components/CommentThread";

export const dynamic = "force-dynamic";

/**
 * A mentor's read-only view of someone else's project.
 *
 * A separate page rather than a mode on the owner's project page. That page is
 * dense with controls — reminders, watches, exports, invites, milestone
 * checkboxes — and every one would need its own "unless you're a mentor" branch.
 * One missed branch is a mentor silently editing a student's work. Here nothing
 * that writes is rendered at all, except the comment box, which is the point.
 */
export default async function OrgProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/sign-in?next=/org/projects/${id}`);

  const access = await getProjectForViewer(id, viewer.id);
  if (!access) notFound();

  // Someone reading their own project doesn't belong on the mentor view — send
  // them to the real one, where they can actually change things.
  if (!access.asMentor) redirect(`/projects/${id}`);

  const { project } = access;
  const comments = await listComments(id);
  void track(EVENTS.ORG_PROJECT_VIEWED, { userId: viewer.id });

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8">
      <Link
        href="/org"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Workspace
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold leading-tight">{project.title}</h1>
        <p className="mt-1 text-sm text-muted">{project.idea}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
          <Eye className="size-3" />
          Mentor view · read only · updated {timeAgo(project.updatedAt)}
        </p>
      </header>

      <div className="space-y-5">
        {project.validationMarkdown && (
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Validation</h2>
            <MarkdownView>{project.validationMarkdown}</MarkdownView>
          </section>
        )}

        {project.research && (
          <ResearchPanel report={project.research} searchProvider="Saved" plan={project.plan} />
        )}

        {project.plan && <ProjectPlanPanel plan={project.plan} provider={null} />}

        {!project.validationMarkdown && !project.research && !project.plan && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
            Nothing saved on this project yet.
          </p>
        )}

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Feedback</h2>
          <CommentThread projectId={project.id} comments={comments} meId={viewer.id} />
        </section>
      </div>
    </main>
  );
}
