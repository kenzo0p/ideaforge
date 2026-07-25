// Telegram Bot API transport. Active only when TELEGRAM_BOT_TOKEN is set; the
// in-app Agent Console works without it. Docs: https://core.telegram.org/bots/api

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${res.status}): ${detail}`);
  }
}

/** Shape of the parts of a Telegram update we care about. */
export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}
