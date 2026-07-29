import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import ExportMenu from "@/components/ExportMenu";
import MarkdownView from "@/components/MarkdownView";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import Workspace from "@/components/Workspace";
import AgentConsole from "@/components/AgentConsole";
import ConnectTelegram from "@/components/ConnectTelegram";
import ProjectReminders from "@/components/ProjectReminders";
import ShareProject from "@/components/ShareProject";
import { getMilestoneProgress, getProject, listWorkspaceItems } from "@/lib/db/projects";
import { listRemindersForProject, listReminderLogs } from "@/lib/db/reminders";
import { isTelegramLinked } from "@/lib/db/telegram";
import { isTelegramConfigured } from "@/lib/agents/telegram";
import { getCurrentUser } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = getProject(id, user.id);
  if (!project) notFound();

  const items = listWorkspaceItems(id);
  const telegramConfigured = isTelegramConfigured();
  const telegramLinked = telegramConfigured && isTelegramLinked(user.id);
  const reminders = listRemindersForProject(id, user.id);
  const reminderHistory = listReminderLogs(id, user.id);
  const completedMilestones = getMilestoneProgress(id);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-tight">{project.title}</h1>
          <p className="mt-1 text-sm text-muted">{project.idea}</p>
          <p className="mt-2 text-xs text-muted">Updated {timeAgo(project.updatedAt)}</p>
        </div>
        <ExportMenu projectId={project.id} />
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
        {project.plan && (
          <ProjectPlanPanel
            plan={project.plan}
            provider="Saved"
            projectId={project.id}
            completedMilestones={completedMilestones}
          />
        )}

        {/* Public sharing */}
        <ShareProject projectId={project.id} initialToken={project.shareToken} />

        {/* AI Agent */}
        <AgentConsole projectId={project.id} />

        {/* Telegram + reminders */}
        {telegramConfigured && (
          <>
            <ConnectTelegram linked={telegramLinked} />
            <ProjectReminders
              projectId={project.id}
              telegramLinked={telegramLinked}
              reminders={reminders}
              history={reminderHistory}
            />
          </>
        )}

        {/* Research Workspace */}
        <Workspace projectId={project.id} items={items} />
      </div>
    </main>
  );
}
