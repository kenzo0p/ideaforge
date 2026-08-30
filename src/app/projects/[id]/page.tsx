import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import ExportMenu from "@/components/ExportMenu";
import ProjectTabBar, { type ProjectTabKey } from "@/components/ProjectTabBar";
import MarkdownView from "@/components/MarkdownView";
import ResearchPanel from "@/components/ResearchPanel";
import ProjectPlanPanel from "@/components/ProjectPlanPanel";
import Workspace from "@/components/Workspace";
import AgentConsole from "@/components/AgentConsole";
import ConnectTelegram from "@/components/ConnectTelegram";
import ProjectReminders from "@/components/ProjectReminders";
import ShareProject from "@/components/ShareProject";
import VersionHistory from "@/components/VersionHistory";
import GroundingCheck from "@/components/GroundingCheck";
import GroundingBadge from "@/components/GroundingBadge";
import ClaimCheck from "@/components/ClaimCheck";
import ConsistencyCheck from "@/components/ConsistencyCheck";
import { claimsAction, groundingAction } from "@/lib/research-actions";
import { checkConsistency } from "@/lib/verify/consistency";
import Collaborators from "@/components/Collaborators";
import CommentThread from "@/components/CommentThread";
import { collaborationStateAction } from "@/lib/collab-actions";
import { integrationStatusAction } from "@/lib/integration-actions";
import WatchPanel from "@/components/WatchPanel";
import { watchStatusAction } from "@/lib/watch-actions";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { getMilestoneProgress, getProject, listWorkspaceItems } from "@/lib/db/projects";
import { listRemindersForProject, listReminderLogs } from "@/lib/db/reminders";
import { isTelegramLinked } from "@/lib/db/telegram";
import { isTelegramConfigured } from "@/lib/agents/telegram";
import { getCurrentUser } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const TAB_KEYS: ProjectTabKey[] = ["validation", "research", "plan", "workspace", "collaborate"];

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getProject(id, user.id);
  if (!project) notFound();

  // ?tab=… drives which section renders; the sidebar and tab bar both link here.
  const requested = (await searchParams).tab as ProjectTabKey | undefined;
  const activeTab: ProjectTabKey =
    requested && TAB_KEYS.includes(requested) ? requested : "validation";

  const items = await listWorkspaceItems(id);
  const telegramConfigured = isTelegramConfigured();
  const telegramLinked = telegramConfigured && await isTelegramLinked(user.id);
  const reminders = await listRemindersForProject(id, user.id);
  const reminderHistory = await listReminderLogs(id, user.id);
  const completedMilestones = await getMilestoneProgress(id);
  const collab = await collaborationStateAction(id);
  const integrationStatus = await integrationStatusAction();
  const watchState = await watchStatusAction(id);
  const grounding = await groundingAction(id);
  const claims = await claimsAction(id);
  // Pure and instant — no network, no model — so it runs on every load rather
  // than waiting to be asked for.
  const consistency = checkConsistency({
    validationMarkdown: project.validationMarkdown,
    research: project.research,
    plan: project.plan,
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Updated {timeAgo(project.updatedAt)}</span>
            {/* The score belongs beside the title, not buried in a tab. How much
                of this brief survived being checked is the first thing that
                should qualify everything under it. */}
            {project.research && (project.research.citations?.length ?? 0) > 0 && (
              <Link href={`/projects/${project.id}?tab=research`} className="hover:opacity-80">
                <GroundingBadge
                  score={grounding?.groundingScore ?? null}
                  verified={grounding?.verified}
                  total={grounding?.verdicts.length}
                />
              </Link>
            )}
          </div>
        </div>
        <ExportMenu
          projectId={project.id}
          integrations={{
            notionAvailable: integrationStatus?.available.notion ?? false,
            googleAvailable: integrationStatus?.available.google ?? false,
          }}
        />
      </header>

      {/* Above the tabs: a contradiction between the research and the plan
          belongs to neither tab, and putting it inside one would hide it from
          whoever opened the other. */}
      {consistency.ran > 0 && (
        <div className="mb-4">
          <ConsistencyCheck report={consistency} />
        </div>
      )}

      <ProjectTabBar
        projectId={project.id}
        active={activeTab}
        ready={{
          validation: !!project.validationMarkdown,
          research: !!project.research,
          plan: !!project.plan,
        }}
      />

      <div className="mt-4 space-y-5">
        {activeTab === "validation" &&
          (project.validationMarkdown ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-3 text-sm font-semibold">
                <Sparkles className="size-4 text-brand" />
                Problem Validation
              </div>
              <MarkdownView>{project.validationMarkdown}</MarkdownView>
            </div>
          ) : (
            <EmptySection label="No validation saved for this project." />
          ))}

        {activeTab === "research" && (
          <>
            {/* The monitor sits above the briefing it keeps fresh — someone who
                has just read stale research is exactly who wants this. */}
            <WatchPanel
              projectId={project.id}
              watch={watchState?.watch ?? null}
              findings={watchState?.findings ?? []}
            />
            {project.research ? (
              <>
                {/* Verification sits above the report: whether the sources hold
                    up changes how you should read everything below it. */}
                <GroundingCheck
                  projectId={project.id}
                  citationCount={project.research.citations?.length ?? 0}
                  initial={grounding}
                />
                {/* Reachability, then substance. The order matters: a source
                    that does not resolve cannot support anything, so there is
                    no point reading a claim verdict about it first. */}
                <ClaimCheck
                  projectId={project.id}
                  hasResearch={!!project.research.summaryMarkdown}
                  initial={claims}
                />
                <div className="mt-5">
                  <ResearchPanel report={project.research} searchProvider="Saved" plan={project.plan} />
                </div>
              </>
            ) : (
              <EmptySection label="No research saved for this project." />
            )}
          </>
        )}

        {activeTab === "plan" &&
          (project.plan ? (
            <ProjectPlanPanel
              plan={project.plan}
              provider="Saved"
              projectId={project.id}
              completedMilestones={completedMilestones}
            />
          ) : (
            <EmptySection label="No plan saved for this project." />
          ))}

        {activeTab === "workspace" && <Workspace projectId={project.id} items={items} />}

        {activeTab === "collaborate" && (
          <>
            {collab && (
              <Collaborators
                projectId={project.id}
                isOwner={collab.isOwner}
                ownerLabel={collab.isOwner ? (user.name ?? user.email) : "Project owner"}
                members={collab.members}
                invites={collab.invites}
                meId={collab.me}
              />
            )}
            {collab && (
              <CommentThread projectId={project.id} comments={collab.comments} meId={collab.me} />
            )}
            {/* A teammate's comment or join lands here without a refresh. */}
            <RealtimeRefresh projectId={project.id} />
            {/* Sharing is the owner's call — a collaborator shouldn't be able to
                publish someone else's project to the open web. */}
            {collab?.isOwner && (
              <ShareProject
                projectId={project.id}
                initialToken={project.shareToken}
                initialListed={project.listed}
              />
            )}
            {/* History sits with the other project-level tools rather than on a
                tab of its own: it is something you reach for after a
                regeneration, not a place you go. */}
            <VersionHistory projectId={project.id} isOwner={!!collab?.isOwner} />
            <AgentConsole projectId={project.id} />
            {telegramConfigured && <ConnectTelegram linked={telegramLinked} />}
            {telegramConfigured && (
              <ProjectReminders
                projectId={project.id}
                telegramLinked={telegramLinked}
                reminders={reminders}
                history={reminderHistory}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted">
      {label}
    </div>
  );
}
