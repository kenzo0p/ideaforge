import { runDueReminders } from "@/lib/reminders/scheduler";
import { runDueWatches } from "@/lib/watch/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/reminders — delivers due reminder nudges.
 *
 * On a persistent server the in-process scheduler handles this. On serverless
 * (Vercel) there is no long-lived timer, so Vercel Cron calls this endpoint on a
 * schedule instead (see vercel.json).
 *
 * Vercel signs cron requests with CRON_SECRET; when that's set we require it so
 * the endpoint can't be triggered by anyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  }

  try {
    const [reminders, watches] = await Promise.all([runDueReminders(), runDueWatches()]);
    return Response.json({ ok: true, reminders, watches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reminder run failed.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
