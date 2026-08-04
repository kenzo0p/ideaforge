"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, UserPlus, X } from "lucide-react";
import {
  addOrgMemberAction,
  leaveOrgAction,
  removeOrgMemberAction,
  setOrgRoleAction,
} from "@/lib/org-actions";
import UpgradePrompt from "@/components/UpgradePrompt";
import type { OrgRole } from "@/lib/db/orgs";

type Member = {
  userId: string;
  role: OrgRole;
  name: string | null;
  username: string;
  email: string;
  via: "created" | "domain" | "invite";
};

const ROLE_HELP: Record<OrgRole, string> = {
  owner: "Manages seats, domains, and roles",
  mentor: "Can read everyone's projects and comment",
  member: "Normal access, on the workspace plan",
};

export default function OrgMembers({
  members,
  isOwner,
  youId,
  seats,
  used,
}: {
  members: Member[];
  isOwner: boolean;
  youId: string;
  seats: number;
  used: number;
}) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<{ reason: string; plan: "pro" | "team" } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string; upgradeTo?: "pro" | "team" }>) {
    setError(null);
    setUpgrade(null);
    start(async () => {
      const res = await fn();
      // A full workspace is a sales conversation, not a failure.
      if (res.error && res.upgradeTo) {
        return setUpgrade({ reason: res.error, plan: res.upgradeTo });
      }
      if (res.error) return setError(res.error);
      setHandle("");
      router.refresh();
    });
  }

  return (
    <div>
      {isOwner ? (
        <>
          <ul className="mb-4 divide-y divide-border">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.name ?? `@${m.username}`}
                    {m.userId === youId && <span className="ml-1.5 text-xs text-muted">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    @{m.username} · joined by {m.via === "created" ? "creating it" : m.via}
                  </span>
                </span>

                <select
                  value={m.role}
                  onChange={(e) => run(() => setOrgRoleAction(m.userId, e.target.value as OrgRole))}
                  disabled={pending}
                  aria-label={`Role for @${m.username}`}
                  title={ROLE_HELP[m.role]}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand disabled:opacity-50"
                >
                  <option value="member">Member</option>
                  <option value="mentor">Mentor</option>
                  <option value="owner">Owner</option>
                </select>

                <button
                  onClick={() => run(() => removeOrgMemberAction(m.userId))}
                  disabled={pending}
                  aria-label={`Remove @${m.username}`}
                  className="rounded-md p-1 text-muted transition hover:bg-hover hover:text-danger disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-surface px-3">
              <span className="text-sm text-muted">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="username"
                className="min-w-0 flex-1 bg-transparent py-2 pl-1 text-sm outline-none"
              />
            </div>
            <button
              onClick={() => run(() => addOrgMemberAction(handle))}
              disabled={pending || !handle.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
              Add
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            {used} of {seats} seats used. Anyone on a claimed domain joins without being added
            here.
          </p>
        </>
      ) : (
        <p className="mb-4 text-sm text-muted">
          Your workspace owner manages who&apos;s in here.
        </p>
      )}

      <button
        onClick={() => run(leaveOrgAction)}
        disabled={pending}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted underline transition hover:text-danger disabled:opacity-50"
      >
        <LogOut className="size-3" />
        Leave this workspace
      </button>

      {upgrade && (
        <UpgradePrompt reason={upgrade.reason} plan={upgrade.plan} limit="org_seats" compact />
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
