import { handleAgentMessage, type AgentInput } from "@/lib/agents/handler";
import {
  answerCallbackQuery,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/agents/telegram";
import {
  getActiveProjectId,
  getUserByChatId,
  linkTelegramChat,
  setActiveProject,
} from "@/lib/db/telegram";

export const runtime = "nodejs";

// POST /api/agents/telegram — Telegram webhook (the serverless counterpart to
// long-polling; identical behaviour, different transport).
//
// Register it once after deploying:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<PUBLIC_URL>/api/agents/telegram&secret_token=<SECRET>"
// Telegram echoes that secret back in X-Telegram-Bot-Api-Secret-Token.
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

  // A tapped button arrives as a callback_query; treat its data as typed input
  // so buttons and commands can't drift apart.
  const cq = update.callback_query;
  if (cq) {
    await answerCallbackQuery(cq.id);
    const cqChat = cq.message?.chat?.id;
    if (cqChat !== undefined && cq.data) {
      try {
        await route(cqChat, cq.data);
      } catch (err) {
        console.error("Telegram webhook callback error:", err);
      }
    }
    return Response.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;

  // Telegram expects a fast 200; ack even when there's nothing to do.
  if (!text || chatId === undefined) return Response.json({ ok: true });

  try {
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
      return Response.json({ ok: true });
    }

    if (/^\/start$/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        "👋 *IdeaForge Agent*\nConnect your account to get started: open IdeaForge → *Connect Telegram* and tap the link. Then send /projects.",
      );
      return Response.json({ ok: true });
    }

    await route(chatId, text);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    await sendTelegramMessage(chatId, "⚠️ Something went wrong. Try again.").catch(() => {});
  }

  return Response.json({ ok: true });
}

/** One instruction → one reply, shared by typed messages and button taps. */
async function route(chatId: number, text: string): Promise<void> {
  const user = await getUserByChatId(chatId);
  const input: AgentInput = {
    text,
    userId: user?.id ?? null,
    // The chat remembers which project it's talking about between messages.
    projectId: user ? await getActiveProjectId(chatId) : null,
    channel: "telegram",
    onSelectProject: (projectId) => void setActiveProject(chatId, projectId),
  };
  const reply = await handleAgentMessage(input);
  await sendTelegramMessage(chatId, reply, input.buttons);
}
