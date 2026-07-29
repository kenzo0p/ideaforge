"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, Check, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { createReminderAction, deleteReminderAction } from "@/lib/actions";
import type { Reminder, ReminderLog } from "@/lib/db/reminders";
import { timeAgo } from "@/lib/format";

const OPTIONS: Array<{ cadence: string; label: string }> = [
  { cadence: "daily", label: "Daily" },
  { cadence: "3day", label: "Every 3 days" },
  { cadence: "weekly", label: "Weekly" },
  { cadence: "test", label: "In ~1 min (test)" },
];

export default function ProjectReminders({
  projectId,
  telegramLinked,
  reminders,
  history,
}: {
  projectId: string;
  telegramLinked: boolean;
  reminders: Reminder[];
  history: ReminderLog[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Bell className="size-4 text-brand" />
        Reminders
      </div>
      <p className="mb-4 text-sm text-muted">
        The Telegram bot nudges you with this project&apos;s next step on a schedule you pick.
      </p>

      {!telegramLinked && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <Send className="mr-1 inline size-3.5" />
          Connect Telegram from your{" "}
          <Link href="/dashboard" className="font-medium underline">
            dashboard
          </Link>{" "}
          to receive reminders.
        </div>
      )}

      {/* Create */}
      <div className="mb-4 flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.cadence}
            onClick={() => startTransition(() => createReminderAction(projectId, o.cadence))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-brand/50 disabled:opacity-50"
          >
            <Plus className="size-3.5" /> {o.label}
          </button>
        ))}
      </div>

      {/* Active list */}
      {reminders.length === 0 ? (
        <p className="text-sm text-muted">No reminders set.</p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 p-3"
            >
              <div className="text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="ml-2 text-xs text-muted">
                  next: {new Date(r.nextDueAt).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => startTransition(() => deleteReminderAction(r.id, projectId))}
                disabled={pending}
                className="shrink-0 rounded-md p-1 text-muted transition hover:text-rose-500"
                aria-label="Cancel reminder"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Sent history */}
      {history.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Recent nudges
          </h3>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full ${
                    h.delivered ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
                  }`}
                  title={h.delivered ? "Delivered to Telegram" : "Not delivered (Telegram not linked)"}
                >
                  {h.delivered ? <Check className="size-2.5" /> : <Send className="size-2.5" />}
                </span>
                <span className="text-muted">
                  <span className="text-foreground/80">{timeAgo(h.createdAt)}</span> — {h.nextStep}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
