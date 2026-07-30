// Next.js runs register() once when the server starts.
//
// The Telegram long-poller and the reminder scheduler are *long-running loops*.
// They only work on a persistent server, so they're skipped on serverless
// platforms (Vercel), where the equivalents are:
//   • Telegram  → the webhook route at /api/agents/telegram
//   • Reminders → a scheduled hit on /api/cron/reminders (see vercel.json)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Vercel sets VERCEL=1; DISABLE_BACKGROUND_WORKERS forces the same behaviour.
  const serverless = !!process.env.VERCEL || process.env.DISABLE_BACKGROUND_WORKERS === "1";
  if (serverless) return;

  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { startTelegramPolling } = await import("@/lib/agents/telegram-poll");
    startTelegramPolling();
    const { startReminderScheduler } = await import("@/lib/reminders/scheduler");
    startReminderScheduler();
  }
}
