"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AtSign, Clock, Crown, LogOut, Send, UserPlus, X } from "lucide-react";
import {
  inviteCollaboratorAction,
  removeMemberAction,
  revokeInviteAction,
  searchUsernamesAction,
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
 * Members, pending invitations, and the invite box.
 *
 * People are invited by handle, not email — the invitation lands in their
 * notifications inside the app, so nothing depends on a mail provider.
 * Permissions are enforced in the server actions; this only decides what's
 * worth rendering.
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
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ username: string; name: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced handle lookup — one request per pause, not per keystroke.
  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    let live = true;
    const t = setTimeout(async () => {
      // Short queries clear the list rather than searching — done inside the
      // timer so no state is set synchronously during the effect.
      const found = q.length < 2 ? [] : await searchUsernamesAction(q);
      if (live) setMatches(found);
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMatches([]);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function invite(handle?: string) {
    const target = (handle ?? query).trim().replace(/^@/, "");
    if (!target) return;
    setError(null);
    setSent(null);
    setMatches([]);
    start(async () => {
      const res = await inviteCollaboratorAction(projectId, target);
      if (res.error) return setError(res.error);
      setQuery("");
      setSent(target);
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
            <Avatar label={m.name ?? m.username} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{m.name ?? m.username}</p>
              <p className="truncate text-xs text-muted">@{m.username}</p>
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
            <li key={inv.id} className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface">
                <Clock className="size-3.5 text-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted">@{inv.toUsername}</p>
                <p className="text-xs text-muted">Invitation pending</p>
              </div>
              <button
                onClick={() => start(async () => void (await revokeInviteAction(projectId, inv.toUserId)))}
                title="Cancel invitation"
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
          <div ref={boxRef} className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <AtSign className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && invite()}
                  placeholder="username"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-border-strong bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-brand/60"
                />
              </div>
              <button
                onClick={() => invite()}
                disabled={pending || !query.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
              >
                <Send className="size-3.5" /> {pending ? "Inviting…" : "Invite"}
              </button>
            </div>

            {matches.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
                {matches.map((m) => (
                  <li key={m.username}>
                    <button
                      onClick={() => invite(m.username)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-hover"
                    >
                      <Avatar label={m.name ?? m.username} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{m.name ?? m.username}</span>
                        <span className="block truncate text-xs text-muted">@{m.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-2 text-xs text-muted">
            They&apos;ll see the invitation in their notifications — no email needed.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          {sent && !error && (
            <p className="mt-2 text-sm text-success">Invitation sent to @{sent}.</p>
          )}
        </div>
      )}
    </div>
  );
}
