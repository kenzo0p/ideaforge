"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Globe, Link2, Loader2, Lock, Search } from "lucide-react";
import { disableShareAction, enableShareAction, setListedAction } from "@/lib/actions";

// Public read-only sharing: mint / revoke a link to the project brief.
export default function ShareProject({
  projectId,
  initialToken,
  initialListed = false,
}: {
  projectId: string;
  initialToken: string | null;
  /** Whether the brief is already in the public directory. */
  initialListed?: boolean;
}) {
  const [token, setToken] = useState(initialToken);
  const [listed, setListed] = useState(initialListed);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}` : null;

  function enable() {
    startTransition(async () => {
      const { token } = await enableShareAction(projectId);
      setToken(token);
    });
  }

  function revoke() {
    startTransition(async () => {
      await disableShareAction(projectId);
      setToken(null);
      // Revoking the link takes the listing with it — the server does the same,
      // and leaving the toggle on would claim a listing that no longer exists.
      setListed(false);
      setCopied(false);
    });
  }

  function togglePublish(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setListedAction(projectId, next);
      if (!res.ok) return setError(res.error ?? "Could not update that.");
      setListed(next);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the input below is selectable as a fallback */
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
            {token ? <Globe className="size-4" /> : <Lock className="size-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              Share
              {token && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  Public link on
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {token
                ? "Anyone with the link can view this brief (read-only)."
                : "Create a read-only link to share this brief with teammates or judges."}
            </p>
          </div>
        </div>

        <button
          onClick={token ? revoke : enable}
          disabled={pending}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            token
              ? "border border-border text-muted hover:text-danger"
              : "bg-brand-solid text-on-brand hover:opacity-90"
          }`}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          {token ? "Revoke" : "Create link"}
        </button>
      </div>

      {url && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-xs outline-none"
          />
          <button
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:border-brand/50"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* A second, explicit decision. A share link is unlisted: people send them
          to a professor or a teammate. Putting those pages in Google without
          asking would publish someone's unlaunched idea. */}
      {token && (
        <div className="mt-4 border-t border-border pt-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={listed}
              disabled={pending}
              onChange={(e) => togglePublish(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand-solid)] disabled:opacity-50"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Search className="size-3.5 text-brand" />
                List it publicly
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Adds this brief to{" "}
                <a href="/explore" className="underline hover:text-foreground">
                  Explore
                </a>{" "}
                and lets search engines index it. Off by default — your link stays
                unlisted until you turn this on.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
