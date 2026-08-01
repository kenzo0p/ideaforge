"use client";

import { useTransition } from "react";
import { Check, FolderPlus, X } from "lucide-react";
import { acceptInviteAction, declineInviteAction } from "@/lib/collab-actions";
import { timeAgo } from "@/lib/format";
import type { ProjectInvite } from "@/lib/db/collaboration";

/** Pending project invitations, accepted or declined without leaving the app. */
export default function InviteInbox({ invites }: { invites: ProjectInvite[] }) {
  const [pending, start] = useTransition();
  if (invites.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <FolderPlus className="size-4 text-brand" /> Project invitations
      </h2>
      <ul className="space-y-2">
        {invites.map((inv) => (
          <li
            key={inv.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand/5 p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-semibold">@{inv.invitedByUsername}</span> invited you to{" "}
                <span className="font-semibold">{inv.projectTitle}</span>
              </p>
              <p className="text-xs text-muted">{timeAgo(inv.createdAt)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                disabled={pending}
                onClick={() => start(async () => void (await acceptInviteAction(inv.id)))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3 py-1.5 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
              >
                <Check className="size-3.5" /> Accept
              </button>
              <button
                disabled={pending}
                onClick={() => start(async () => void (await declineInviteAction(inv.id)))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
              >
                <X className="size-3.5" /> Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
