import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Rocket } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/db/users";
import { canMentorView, memberProjects } from "@/lib/db/orgs";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/** One member's projects, for a mentor following a cohort. */
export default async function OrgMemberPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) redirect(`/sign-in?next=/org/members/${username}`);

  const member = await getUserByUsername(username.toLowerCase());
  // 404 rather than 403 whenever the viewer isn't entitled: a different status
  // would confirm which handles exist to anyone willing to guess.
  if (!member || !(await canMentorView(viewer.id, member.id))) notFound();

  const projects = await memberProjects(member.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <Link
        href="/org"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Workspace
      </Link>

      <h1 className="text-2xl font-bold">{member.name ?? `@${member.username}`}</h1>
      <p className="mb-8 text-sm text-muted">
        @{member.username} · {projects.length} project{projects.length === 1 ? "" : "s"}
      </p>

      {projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
          Nothing started yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/org/projects/${p.id}`}
                className="group block rounded-xl border border-border bg-card p-4 transition hover:border-brand/50"
              >
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold group-hover:text-brand">
                      {p.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.idea}</p>
                    <p className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                      Updated {timeAgo(p.updatedAt)}
                      {p.hasPlan && (
                        <span className="inline-flex items-center gap-1 text-brand">
                          <Rocket className="size-3" /> has a plan
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
