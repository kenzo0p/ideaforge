// Telegram Bot API transport. Active only when TELEGRAM_BOT_TOKEN is set; the
// in-app Agent Console works without it. Docs: https://core.telegram.org/bots/api

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** One tappable button. `data` comes back verbatim in a callback_query. */
export interface InlineButton {
  text: string;
  data: string;
}

/**
 * Send a message, optionally with tappable buttons.
 *
 * Buttons beat "reply with a number": nothing to type, nothing to mistype, and
 * the chat shows what the options were rather than expecting the reader to
 * scroll back up and count.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...(buttons?.length
        ? {
            reply_markup: {
              inline_keyboard: buttons.map((row) =>
                // Telegram caps callback_data at 64 bytes; ids are UUIDs, so a
                // prefix plus a uuid is 40 and safely inside that.
                row.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) })),
              ),
            },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${res.status}): ${detail}`);
  }
}

/**
 * Acknowledge a button tap.
 *
 * Telegram shows a loading spinner on the button until this is called, so
 * skipping it leaves the chat looking stuck even when the work succeeded.
 */
export async function answerCallbackQuery(id: string, text?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, ...(text ? { text } : {}) }),
  }).catch(() => {});
}

/** Shape of the parts of a Telegram update we care about. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    from?: { first_name?: string };
  };
  /** Sent when someone taps an inline button. */
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
    from?: { first_name?: string };
  };
}

function apiBase(): string {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

/** Long-poll for updates since `offset`. Blocks up to `timeout` seconds. */
export async function getTelegramUpdates(
  offset: number,
  timeout = 30,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  // allowed_updates must list callback_query explicitly, or button taps never
  // arrive — the default set is messages only.
  const res = await fetch(
    `${apiBase()}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=${encodeURIComponent(
      JSON.stringify(["message", "callback_query"]),
    )}`,
    { signal },
  );
  if (!res.ok) throw new Error(`getUpdates failed (${res.status})`);
  const data: { ok: boolean; result?: TelegramUpdate[] } = await res.json();
  return data.result ?? [];
}

/** Remove any configured webhook so long-polling can run without conflict. */
export async function deleteTelegramWebhook(): Promise<void> {
  await fetch(`${apiBase()}/deleteWebhook?drop_pending_updates=false`).catch(() => {});
}

let cachedUsername: string | null = null;

/** The bot's @username (for building t.me deep links). Cached after first call. */
export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const res = await fetch(`${apiBase()}/getMe`);
    const data: { ok: boolean; result?: { username?: string } } = await res.json();
    cachedUsername = data.result?.username ?? null;
    return cachedUsername;
  } catch {
    return null;
  }
}
