import {
  advanceReminder,
  deleteReminder,
  dueReminders,
  logReminderSent,
} from "@/lib/db/reminders";
import { getProject } from "@/lib/db/projects";
import { getChatIdForUser } from "@/lib/db/telegram";
import { sendTelegramMessage } from "@/lib/agents/telegram";
import { projectNextStep } from "@/lib/insights/next-step";

// ---------------------------------------------------------------------------
// Reminder delivery.
//
// `runDueReminders()` sends every nudge that is due — each computed from the
// project's *current* state — then reschedules or retires it. Two callers:
//   • a setInterval loop on a persistent server (startReminderScheduler)
//   • the /api/cron/reminders route on serverless (Vercel Cron)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __ideaforgeReminderScheduler?: boolean };
const TICK_MS = 60_000;
/**
 * Reminders are not urgent, and firing one the instant the process boots means
 * opening the database pool while the server is still starting — on a small
 * instance that contention is what turns a slow TLS handshake into a failed
 * one. Let the app finish coming up first.
 */
const FIRST_TICK_MS = 30_000;

export function startReminderScheduler(): void {
  if (g.__ideaforgeReminderScheduler) return;
  g.__ideaforgeReminderScheduler = true;
  console.log("⏰ Reminder scheduler started.");
  const tick = async () => {
    await runDueReminders();
    // Watches share the timer: both are "do the due work" and neither is
    // urgent, so a second interval would just be more moving parts.
    const { runDueWatches } = await import("@/lib/watch/runner");
    await runDueWatches();
  };
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TICK_MS);
  }, FIRST_TICK_MS).unref?.();
}

/** Deliver all due reminders. Returns how many were processed. */
export async function runDueReminders(): Promise<number> {
  const now = Date.now();
  let due;
  try {
    due = await dueReminders(now);
  } catch (err) {
    console.error("Reminder query failed:", err);
    return 0;
  }

  for (const r of due) {
    try {
      const project = await getProject(r.projectId, r.userId);
      if (!project) {
        await deleteReminder(r.id, r.userId); // project gone — retire the reminder
        continue;
      }

      const nextStep = projectNextStep(project);
      const chatId = await getChatIdForUser(r.userId);
      let delivered = false;
      if (chatId !== null && process.env.TELEGRAM_BOT_TOKEN) {
        const text = `🔔 *Reminder — ${project.title}*\nNext step: ${nextStep}\n\nSend /status for the full picture.`;
        try {
          await sendTelegramMessage(chatId, text);
          delivered = true;
        } catch (e) {
          console.error("Reminder send failed:", e instanceof Error ? e.message : e);
        }
      }
      // Record the fire, then reschedule (recurring) or retire (one-off).
      await logReminderSent({ userId: r.userId, projectId: r.projectId, nextStep, delivered });
      await advanceReminder(r.id, r.intervalMs, now);
    } catch (err) {
      console.error("Reminder processing error:", err);
    }
  }
  return due.length;
}
