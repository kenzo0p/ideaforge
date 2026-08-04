"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { createOrgAction, refreshOrgMembershipAction } from "@/lib/org-actions";

/**
 * Two ways in, side by side.
 *
 * Most people arriving here have been told "we have a workspace" and just need
 * to be picked up by their domain. Offering only "create one" would have them
 * making a second workspace for an institution that already has one.
 */
export default function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-brand" />
          Create a workspace
        </h2>
        <p className="mb-3 text-xs text-muted">
          Name it after the lab, course, or organisation. You&apos;ll claim your email
          domain next.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CSE Innovation Lab"
            maxLength={80}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={() => run(() => createOrgAction(name))}
            disabled={pending || name.trim().length < 2}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border p-5">
        <h2 className="mb-1 text-sm font-semibold">Already have one?</h2>
        <p className="mb-3 text-xs text-muted">
          If your institution has claimed your email domain, this puts you in it.
        </p>
        <button
          onClick={() => run(refreshOrgMembershipAction)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" />
          Check for my workspace
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
