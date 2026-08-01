"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Crown, LogOut, Mail, Send, UserPlus, X } from "lucide-react";
import {
  inviteCollaboratorAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/lib/collab-actions";
import type { ProjectMember } from "@/lib/db/projects";
import type { ProjectInvite } from "@/lib/db/collaboration";

function Avatar({ label }: { label: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold uppercase text-brand">
      {label.slice(0, 2)}
    </span>
  );
}

/**
 * Members, pending invitations, and the invite form.
 *
 * The owner sees everything; a collaborator sees the roster and a "leave"
 * button. Permissions are enforced in the server actions — this only decides
 * what's worth rendering.
 */
export default function Collaborators({
  projectId,
  isOwner,
  ownerLabel,
  members,
  invites,
  meId,
}: {
  projectId: string;
  isOwner: boolean;
  ownerLabel: string;
  members: ProjectMember[];
  invites: ProjectInvite[];
  meId: string;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function invite() {
    setError(null);
    setLink(null);
    start(async () => {
      const res = await inviteCollaboratorAction(projectId, email);
      if (res.error) return setError(res.error);
      setEmail("");
      // Delivery failed but the invitation is real — offer the link instead.
      if (res.inviteLink) setLink(res.inviteLink);
    });
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <UserPlus className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">People</h2>
        <span className="text-xs text-muted">
          {members.length + 1} {members.length === 0 ? "person" : "people"}
        </span>
      </div>

      <ul className="space-y-2">
        <li className="flex items-center gap-2.5">
          <Avatar label={ownerLabel} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="truncate">{ownerLabel}</span>
              <Crown className="size-3 shrink-0 text-warning" />
            </div>
            <p className="text-xs text-muted">Owner</p>
          </div>
        </li>

        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2.5">
            <Avatar label={m.name ?? m.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{m.name ?? m.email}</p>
              <p className="truncate text-xs text-muted">{m.email}</p>
            </div>
            {(isOwner || m.userId === meId) && (
              <button
                onClick={() => start(async () => void (await removeMemberAction(projectId, m.userId)))}
                title={m.userId === meId ? "Leave project" : "Remove"}
                className="rounded-md p-1.5 text-muted transition hover:bg-hover hover:text-danger"
              >
                {m.userId === meId ? <LogOut className="size-3.5" /> : <X className="size-3.5" />}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && invites.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {invites.map((inv) => (
            <li key={inv.token} className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface">
                <Mail className="size-3.5 text-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted">{inv.email}</p>
                <p className="text-xs text-muted">Invitation pending</p>
              </div>
              <button
                onClick={() => start(async () => void (await revokeInviteAction(projectId, inv.email)))}
                title="Revoke invitation"
                className="rounded-md p-1.5 text-muted transition hover:bg-hover hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
              placeholder="teammate@example.com"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand/60"
            />
            <button
              onClick={invite}
              disabled={pending || !email.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
            >
              <Send className="size-3.5" /> {pending ? "Inviting…" : "Invite"}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}

          {link && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="mb-2 text-warning">
                Couldn&apos;t email them — the invitation is valid, so send this link yourself.
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-hover"
              >
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy invite link"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
