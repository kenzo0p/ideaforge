import { handleAgentMessage } from "@/lib/agents/handler";
import { sendTelegramMessage, type TelegramUpdate } from "@/lib/agents/telegram";

export const runtime = "nodejs";

// POST /api/agents/telegram — Telegram webhook.
//
// Set the webhook to this URL and secure it with TELEGRAM_WEBHOOK_SECRET:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<PUBLIC_URL>/api/agents/telegram&secret_token=<SECRET>"
// Telegram sends that secret back in the X-Telegram-Bot-Api-Secret-Token header.
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;

  // Telegram expects a 200 quickly; ack even when there's nothing to do.
  if (!text || chatId === undefined) return Response.json({ ok: true });

  try {
    // Note: project scoping per Telegram chat would be persisted per session;
    // for now the bot answers commands and general guidance.
    const reply = await handleAgentMessage({ text, channel: "telegram" });
    await sendTelegramMessage(chatId, reply);
  } catch {
    await sendTelegramMessage(chatId, "⚠️ Something went wrong. Try again.").catch(() => {});
  }

  return Response.json({ ok: true });
}
