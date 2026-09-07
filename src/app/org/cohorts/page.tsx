import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import CohortWorkbench from "@/components/CohortWorkbench";
import { getCurrentUser } from "@/lib/auth/session";
import { membershipFor } from "@/lib/db/orgs";
import { cohortReport, listBatches } from "@/lib/db/cohorts";

export const dynamic = "force-dynamic";

/**
 * The supervisor's page.
 *
 * Separate from /org because the audience is different: /org answers "what is
 * my workspace", this answers "what did my cohort submit". Mentors and owners
 * only — the report names students alongside their proposals and says which
 * resemble each other.
 */
export default async function CohortsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/org/cohorts");

  const membership = await membershipFor(user.id);
  if (!membership) redirect("/org");
  if (membership.role === "member") redirect("/org");

  const batches = await listBatches(membership.org.id);
  // The newest batch is what a supervisor almost always wants, so it is
  // rendered rather than fetched after the page has already drawn without it.
  const initialReport = batches[0]
    ? await cohortReport({ orgId: membership.org.id, batch: batches[0].batch })
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <Link
        href="/org"
        className="no-print mb-4 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {membership.org.name}
      </Link>

      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Users className="size-6 text-brand" />
        Cohort submissions
      </h1>
      <p className="no-print mb-6 max-w-prose text-sm text-muted">
        Paste a batch of proposals straight from wherever they already are, and see which of
        them resemble each other before anyone starts building. Students do not need accounts
        for this — the submissions are compared as a batch and can be deleted as one.
      </p>

      <CohortWorkbench initialBatches={batches} initialReport={initialReport} />
    </main>
  );
}
