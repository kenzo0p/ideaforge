"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Loader2, Send } from "lucide-react";
import { connectTelegramAction, unlinkTelegramAction } from "@/lib/actions";

// "Connect Telegram" control for the dashboard. Mints a deep link the user taps
// to bind their Telegram chat to their Scrutan account.
export default function ConnectTelegram({ linked }: { linked: boolean }) {
  const [pending, startTransition] = useTransition();
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [isLinked, setIsLinked] = useState(linked);

  function connect() {
    startTransition(async () => {
      const { deepLink } = await connectTelegramAction();
      setDeepLink(deepLink);
      if (deepLink) window.open(deepLink, "_blank", "noopener");
    });
  }

  function unlink() {
    startTransition(async () => {
      await unlinkTelegramAction();
      setIsLinked(false);
      setDeepLink(null);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-info/15 text-info">
            <Send className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              Telegram Agent
              {isLinked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  <Check className="size-3" /> Connected
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              Ask about your projects from Telegram — /projects, /status, /next, /plan.
            </p>
          </div>
        </div>

        {isLinked ? (
          <button
            onClick={unlink}
            disabled={pending}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:text-danger disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Disconnect"}
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={pending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-solid px-3 py-1.5 text-xs font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Connect
          </button>
        )}
      </div>

      {deepLink && !isLinked && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3 text-xs">
          <p className="mb-2 text-muted">
            A Telegram tab should have opened. If not, tap the link, then press{" "}
            <span className="font-medium text-foreground">Start</span> in the chat:
          </p>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            Open the bot <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}
