import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Check, Send } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { listAllReminderLogs } from "@/lib/db/reminders";
import { markNotificationsSeen } from "@/lib/db/users";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

// Every reminder nudge across all projects, newest first. Visiting the page
// clears the unread badge.
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const notifications = listAllReminderLogs(user.id);
  const seenAt = user.notificationsSeenAt;
  // Clear the badge for future page loads (this render still highlights new items).
  markNotificationsSeen(user.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Bell className="size-6 text-brand" />
        Notifications
      </h1>
      <p className="mb-8 text-sm text-muted">
        Reminder nudges sent by your agent, across every project.
      </p>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Bell className="size-5" />
          </span>
          <p className="text-lg font-semibold">No notifications yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Set a reminder on a project and your agent&apos;s nudges will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const isNew = n.createdAt > seenAt;
            return (
              <li
                key={n.id}
                className={`flex items-start gap-3 rounded-xl border bg-card p-4 transition ${
                  isNew ? "border-brand/40" : "border-border"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${
                    n.delivered
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-amber-500/15 text-amber-500"
                  }`}
                  title={n.delivered ? "Delivered to Telegram" : "Not delivered"}
                >
                  {n.delivered ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/projects/${n.projectId}`}
                      className="truncate text-sm font-semibold hover:text-brand"
                    >
                      {n.projectTitle}
                    </Link>
                    {isNew && (
                      <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted">Next step: {n.nextStep}</p>
                </div>

                <span className="shrink-0 text-xs text-muted">{timeAgo(n.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
