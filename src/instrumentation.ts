// Next.js runs register() once when the server starts. We use it to launch the
// Telegram long-polling worker and the reminder scheduler (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Reminder scheduler runs whenever there's a bot to deliver through.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { startTelegramPolling } = await import("@/lib/agents/telegram-poll");
    startTelegramPolling();
    const { startReminderScheduler } = await import("@/lib/reminders/scheduler");
    startReminderScheduler();
  }
}
