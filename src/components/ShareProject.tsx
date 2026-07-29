"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Globe, Link2, Loader2, Lock } from "lucide-react";
import { disableShareAction, enableShareAction } from "@/lib/actions";

// Public read-only sharing: mint / revoke a link to the project brief.
export default function ShareProject({
  projectId,
  initialToken,
}: {
  projectId: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
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
      setCopied(false);
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
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
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
              ? "border border-border text-muted hover:text-rose-500"
              : "bg-brand text-white hover:opacity-90"
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
            className="flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-xs outline-none"
          />
          <button
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:border-brand/50"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
