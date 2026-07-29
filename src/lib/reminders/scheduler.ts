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
// Reminder scheduler.
//
// Runs inside the Node server (started from instrumentation.ts). Every minute it
// sends due nudges — each computed from the project's *current* state — to the
// user's linked Telegram chat, then reschedules or retires the reminder.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __ideaforgeReminderScheduler?: boolean };
const TICK_MS = 60_000;

export function startReminderScheduler(): void {
  if (g.__ideaforgeReminderScheduler) return;
  g.__ideaforgeReminderScheduler = true;
  console.log("⏰ Reminder scheduler started.");
  void tick();
  setInterval(() => void tick(), TICK_MS);
}

async function tick(): Promise<void> {
  const now = Date.now();
  let due;
  try {
    due = dueReminders(now);
  } catch (err) {
    console.error("Reminder scheduler query failed:", err);
    return;
  }

  for (const r of due) {
    try {
      const project = getProject(r.projectId, r.userId);
      if (!project) {
        deleteReminder(r.id, r.userId); // project gone — retire the reminder
        continue;
      }

      const nextStep = projectNextStep(project);
      const chatId = getChatIdForUser(r.userId);
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
      logReminderSent({ userId: r.userId, projectId: r.projectId, nextStep, delivered });
      advanceReminder(r.id, r.intervalMs, now);
    } catch (err) {
      console.error("Reminder processing error:", err);
    }
  }
}
