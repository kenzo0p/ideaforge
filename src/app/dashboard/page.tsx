import Link from "next/link";
import { redirect } from "next/navigation";
import { Compass, LayoutDashboard, Plus, Rocket, Sparkles } from "lucide-react";
import ConnectTelegram from "@/components/ConnectTelegram";
import ProjectFilters from "@/components/ProjectFilters";
import GettingStarted from "@/components/GettingStarted";
import { dismissOnboardingAction, isOnboardingDismissed } from "@/lib/onboarding-actions";
import { listProjects, milestoneCounts } from "@/lib/db/projects";
import { getGroundingScores } from "@/lib/db/grounding";
import { isTelegramLinked } from "@/lib/db/telegram";
import { isTelegramConfigured } from "@/lib/agents/telegram";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic"; // always reflect the latest saved data

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const projects = await listProjects(user.id);
  const doneCounts = await milestoneCounts(user.id);
  const grounding = await getGroundingScores(projects.map((p) => p.id));
  const telegramConfigured = isTelegramConfigured();
  const telegramLinked = telegramConfigured && await isTelegramLinked(user.id);

  // Progress is derived from real work, not from a tutorial flag — the list
  // ticks itself off as the account actually uses the product.
  const dismissedOnboarding = await isOnboardingDismissed();
  const progress = {
    validated: projects.some((p) => p.hasValidation),
    researched: projects.some((p) => p.hasResearch),
    planned: projects.some((p) => p.hasPlan),
    collaborated: projects.some((p) => p.memberCount > 0 || !p.isOwner),
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      {!dismissedOnboarding && (
        <GettingStarted progress={progress} onDismiss={dismissOnboardingAction} />
      )}

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <LayoutDashboard className="size-6 text-brand" />
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">
            {projects.length === 0
              ? "Your saved projects will appear here."
              : `${projects.length} saved ${projects.length === 1 ? "project" : "projects"}.`}
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
        >
          <Plus className="size-4" /> New idea
        </Link>
      </div>

      {telegramConfigured && (
        <div className="mb-6">
          <ConnectTelegram linked={telegramLinked} />
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ProjectFilters projects={projects} doneCounts={doneCounts} grounding={grounding} />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
      {/* Subtle layered illustration built from brand tiles + icons */}
      <div className="relative mx-auto mb-5 h-20 w-24">
        <span className="absolute left-1 top-2 flex size-14 rotate-[-8deg] items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <Compass className="size-6 text-muted" />
        </span>
        <span className="absolute right-1 top-0 flex size-14 rotate-[8deg] items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <Rocket className="size-6 text-muted" />
        </span>
        <span className="absolute bottom-0 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-solid to-brand-2-solid text-on-brand shadow-md">
          <Sparkles className="size-7" />
        </span>
      </div>
      <p className="text-lg font-semibold">No projects yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Start with an idea, validate it, run DeepSearch, and generate a plan — then hit{" "}
        <span className="font-medium text-foreground">Save to dashboard</span>.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
      >
        <Plus className="size-4" /> Start an idea
      </Link>
    </div>
  );
}
