import {
  getActiveProjectId,
  getUserByChatId,
  linkTelegramChat,
  setActiveProject,
} from "@/lib/db/telegram";
import { handleAgentMessage, type AgentInput } from "./handler";
import {
  answerCallbackQuery,
  deleteTelegramWebhook,
  getTelegramUpdates,
  sendTelegramMessage,
  type TelegramUpdate,
} from "./telegram";

// ---------------------------------------------------------------------------
// Telegram long-polling worker.
//
// Runs inside the Node server (started from instrumentation.ts). Long-polling
// works from localhost with no public webhook URL. Guarded by a globalThis flag
// so dev/HMR restarts don't spawn duplicate loops.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __ideaforgeTelegramPolling?: boolean };

export function startTelegramPolling(): void {
  if (g.__ideaforgeTelegramPolling) return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  g.__ideaforgeTelegramPolling = true;
  void loop();
}

async function loop(): Promise<void> {
  // Webhook and getUpdates are mutually exclusive — clear any webhook first.
  await deleteTelegramWebhook();
  console.log("🤖 Telegram bot: long-polling started.");

  let offset = 0;
  while (true) {
    try {
      const updates = await getTelegramUpdates(offset, 30);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update).catch((e) => console.error("Telegram handler error:", e));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 409 is not transient: Telegram allows exactly one getUpdates consumer
      // per bot, so a second instance — usually a dev server left running
      // alongside a deployment — loops here forever. Say what to do about it,
      // and back off hard so the logs stay readable.
      if (message.includes("409")) {
        console.error(
          "Telegram: another process is already polling this bot (HTTP 409). " +
            "Only one may poll at a time — stop the other instance, or set " +
            "DISABLE_BACKGROUND_WORKERS=1 there. Retrying in 60s.",
        );
        await sleep(60_000);
        continue;
      }
      // Network blip / transient error — back off briefly and retry.
      console.error("Telegram poll error:", message);
      await sleep(3000);
    }
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // A button tap arrives as a callback_query, not a message. Its `data` is
  // treated as if the user had typed it, so one code path serves both.
  const cq = update.callback_query;
  if (cq) {
    const cqChat = cq.message?.chat?.id;
    // Always acknowledge, or the button spins forever in the client.
    await answerCallbackQuery(cq.id);
    if (cqChat === undefined || !cq.data) return;
    await route(cqChat, cq.data);
    return;
  }

  const msg = update.message;
  const text = msg?.text?.trim();
  const chatId = msg?.chat?.id;
  if (!text || chatId === undefined) return;

  // Linking: /start <code> (t.me deep link) or /link <code>.
  const linkMatch = text.match(/^\/(?:start|link)\s+(\S+)/i);
  if (linkMatch) {
    const user = await linkTelegramChat(linkMatch[1], chatId);
    await sendTelegramMessage(
      chatId,
      user
        ? `✅ Connected to *${user.email}*.\n\nSend /projects, then reply with a number to pick the project you want to work on.`
        : "⚠️ That link code is invalid or expired. Generate a new one from IdeaForge → Connect Telegram.",
    );
    return;
  }

  // Bare /start with no code.
  if (/^\/start$/i.test(text)) {
    await sendTelegramMessage(
      chatId,
      "👋 *IdeaForge Agent*\nConnect your account to get started: open IdeaForge → *Connect Telegram* and tap the link. Then try /projects.",
    );
    return;
  }

  await route(chatId, text);
}

/**
 * Run one instruction and reply, whether it was typed or tapped.
 *
 * Shared by messages and callback queries so a button and the equivalent
 * command can never drift apart.
 */
async function route(chatId: number, text: string): Promise<void> {
  const user = await getUserByChatId(chatId);
  const input: AgentInput = {
    text,
    userId: user?.id ?? null,
    // The chat remembers which project it's talking about between messages.
    projectId: user ? await getActiveProjectId(chatId) : null,
    channel: "telegram" as const,
    onSelectProject: (projectId: string) => void setActiveProject(chatId, projectId),
  };
  const reply = await handleAgentMessage(input);
  // The handler attaches buttons to `input` when the reply has choices.
  await sendTelegramMessage(chatId, reply, input.buttons);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
