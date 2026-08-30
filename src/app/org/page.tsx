import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, GraduationCap, Globe, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import {
  countOrgMembers,
  listOrgMembers,
  membershipFor,
  orgProjectOverview,
} from "@/lib/db/orgs";
import { clusterWorkspaceIdeas } from "@/lib/db/similar";
import { PLANS, formatLimit } from "@/lib/billing/plans";
import { timeAgo } from "@/lib/format";
import CreateOrgForm from "@/components/CreateOrgForm";
import UpgradePrompt from "@/components/UpgradePrompt";
import OrgDomains from "@/components/OrgDomains";
import OrgMembers from "@/components/OrgMembers";
import CohortNovelty from "@/components/CohortNovelty";

export const dynamic = "force-dynamic";

/**
 * The workspace: one page for the whole institutional side.
 *
 * A department head and a mentor want different things from it — seats and
 * domains versus who is actually working — so both are here and the role
 * decides what's shown, rather than splitting it into pages people have to
 * know about.
 */
export default async function OrgPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/org");

  const membership = await membershipFor(user.id);

  if (!membership) {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-10">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
          <Building2 className="size-6 text-brand" />
          Workspace
        </h1>
        <p className="mb-8 max-w-prose text-sm text-muted">
          A workspace puts a lab, a class, or a cohort on one plan — everyone on your
          email domain joins automatically, and mentors can follow the work without being
          invited to each project one at a time.
        </p>
        <CreateOrgForm />
      </main>
    );
  }

  const { org, role } = membership;
  const isOwner = role === "owner";
  const canMentor = role !== "member";
  const plan = PLANS[org.planId];

  // Every owner is also a mentor, so one roster fetch serves both the member
  // table and the overlap report. What differs is who is allowed to *see* the
  // roster, and that stays a rendering decision below rather than two queries
  // that could drift apart.
  const [roster, used, overview] = await Promise.all([
    canMentor ? listOrgMembers(org.id) : Promise.resolve([]),
    countOrgMembers(org.id),
    canMentor ? orgProjectOverview(org.id) : Promise.resolve([]),
  ]);
  const members = isOwner ? roster : [];

  // Mentors only. The report names people alongside their unpublished ideas,
  // which is a reasonable thing for a guide to see across their own cohort and
  // not something a peer in the same workspace should be handed.
  const novelty = canMentor
    ? await clusterWorkspaceIdeas({ userIds: roster.map((m) => m.userId) }).catch((err) => {
        // A failed comparison must not take the workspace page down with it.
        console.error("Cohort overlap failed:", err instanceof Error ? err.message : err);
        return null;
      })
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Building2 className="size-6 text-brand" />
        {org.name}
      </h1>
      <p className="mb-8 text-sm text-muted">
        {plan.name} workspace · {used} of {org.seats} seats · you&apos;re {role === "owner" ? "an owner" : `a ${role}`}
      </p>

      <div className="space-y-5">
        {org.planId === "free" && isOwner && (
          <UpgradePrompt
            reason="This workspace is on Free. Upgrade it and every seat gets Team."
            plan="team"
            limit="org_plan"
            scope="org"
          />
        )}

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">What every seat gets</h2>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            <li className="text-muted">
              <span className="text-foreground">{formatLimit(plan.limits.projects)}</span> saved projects
            </li>
            <li className="text-muted">
              <span className="text-foreground">{plan.limits.dailyRuns}</span> copilot runs a day
            </li>
            <li className="text-muted">
              <span className="text-foreground">{plan.limits.watches}</span>{" "}
              {plan.limits.watches === 1 ? "watch" : "watches"}, checked{" "}
              {plan.limits.fastestCadence}
            </li>
            <li className="text-muted">
              <span className="text-foreground">{plan.limits.collaboratorsPerProject}</span> collaborators
              per project
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            A seat applies on top of anything someone bought themselves — nobody is
            downgraded by joining.
          </p>
        </section>

        {isOwner && (
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Globe className="size-4 text-brand" />
              Email domains
            </h2>
            <p className="mb-3 max-w-prose text-xs text-muted">
              Anyone who signs in with a verified address on these domains joins
              automatically. You can only claim the domain your own address is on.
            </p>
            <OrgDomains domains={org.emailDomains} yourEmail={user.email} />
          </section>
        )}

        {canMentor && (
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <GraduationCap className="size-4 text-brand" />
              Who&apos;s working on what
            </h2>
            <p className="mb-4 max-w-prose text-xs text-muted">
              Progress across the workspace. Open anyone&apos;s project to read it and leave
              feedback — no need to be invited to each one.
            </p>

            {overview.length === 0 ? (
              <p className="text-sm text-muted">Nobody has started a project yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="pb-2 font-medium">Member</th>
                      <th className="pb-2 text-right font-medium">Projects</th>
                      <th className="pb-2 text-right font-medium">Validated</th>
                      <th className="pb-2 text-right font-medium">Planned</th>
                      <th className="pb-2 text-right font-medium">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.map((row) => (
                      <tr key={row.userId} className="border-b border-border/60 last:border-0">
                        <td className="py-2">
                          <Link
                            href={`/org/members/${row.username}`}
                            className="font-medium hover:text-brand"
                          >
                            {row.name ?? `@${row.username}`}
                          </Link>
                          {row.role !== "member" && (
                            <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
                              {row.role}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{row.projects}</td>
                        <td className="py-2 text-right tabular-nums">{row.validated}</td>
                        <td className="py-2 text-right tabular-nums">{row.withPlan}</td>
                        <td className="py-2 text-right text-xs text-muted">
                          {row.lastActiveAt ? timeAgo(row.lastActiveAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {novelty && <CohortNovelty report={novelty} />}

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-brand" />
            People
          </h2>
          <OrgMembers
            members={members}
            isOwner={isOwner}
            youId={user.id}
            seats={org.seats}
            used={used}
          />
        </section>
      </div>
    </main>
  );
}
