import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck, UserPlus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { consumeInvite, peekInvite } from "@/lib/db/collaboration";
import { addMember, getProject } from "@/lib/db/projects";
import { col } from "@/lib/db/index";

export const dynamic = "force-dynamic";

/**
 * Accept a project invitation.
 *
 * The invitation is bound to an email address, and acceptance requires being
 * signed in as that address. Without that check the link alone would be the
 * credential — anyone it was forwarded to could join the project.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);

  if (!invite) return <Shell title="This invitation has expired" body="Ask for a new one — invitations last 7 days." />;

  // Look up the title without an access check: the invitee can't read the
  // project yet, and the name is what makes the invitation meaningful.
  const projectDoc = await (
    await col<{ _id: string; title: string }>("projects")
  ).findOne({ _id: invite.projectId }, { projection: { title: 1 } });
  if (!projectDoc) return <Shell title="That project no longer exists" body="The owner may have deleted it." />;

  const user = await getCurrentUser();
  if (!user) {
    // Bounce through sign-in and come straight back here.
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell
        title="This invitation is for a different account"
        body={`It was sent to ${invite.email}, but you're signed in as ${user.email}. Sign in with the invited address to accept.`}
      />
    );
  }

  // Already on it — just go.
  if (await getProject(invite.projectId, user.id)) redirect(`/projects/${invite.projectId}`);

  const joined = await acceptInvite(token, invite.projectId, user);
  if (!joined) return <Shell title="This invitation has expired" body="Ask for a new one." />;

  redirect(`/projects/${invite.projectId}?joined=1`);
}

/** Consume the token and add the member. Outside the component so the render
    stays free of side effects and non-deterministic values. */
async function acceptInvite(
  token: string,
  projectId: string,
  user: { id: string; email: string; name: string | null },
): Promise<boolean> {
  const consumed = await consumeInvite(token);
  if (!consumed) return false;
  await addMember(projectId, {
    userId: user.id,
    email: user.email,
    name: user.name,
    joinedAt: Date.now(),
  });
  return true;
}

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand/10">
        <MailCheck className="size-6 text-brand" />
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{body}</p>
      <p className="mt-6 text-sm">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-brand hover:underline">
          <UserPlus className="size-4" /> Go to your dashboard
        </Link>
      </p>
    </div>
  );
}
