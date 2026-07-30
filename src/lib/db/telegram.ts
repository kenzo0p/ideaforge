import { randomBytes } from "node:crypto";
import { one, run } from "./index";
import { getUserById, type User } from "./users";

// ---------------------------------------------------------------------------
// Telegram account linking.
//
// A short-lived code generated in the app is sent to the bot (via a t.me deep
// link); the bot exchanges it to bind the Telegram chat to an IdeaForge user.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 1000 * 60 * 15; // 15 minutes

export async function createTelegramLinkCode(userId: string): Promise<{ code: string }> {
  const code = randomBytes(6).toString("hex"); // 12 chars, deep-link safe
  await run("DELETE FROM telegram_link_codes WHERE user_id = ?", [userId]);
  await run("INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)", [
    code,
    userId,
    Date.now() + CODE_TTL_MS,
  ]);
  return { code };
}

/** Redeem a link code and bind the chat to its user. Returns the user or null. */
export async function linkTelegramChat(code: string, chatId: number): Promise<User | null> {
  const row = await one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM telegram_link_codes WHERE code = ?",
    [code],
  );
  if (!row) return null;
  await run("DELETE FROM telegram_link_codes WHERE code = ?", [code]);
  if (row.expires_at < Date.now()) return null;

  await run(
    "INSERT OR REPLACE INTO telegram_links (chat_id, user_id, created_at) VALUES (?, ?, ?)",
    [chatId, row.user_id, Date.now()],
  );
  return getUserById(row.user_id);
}

export async function getUserByChatId(chatId: number): Promise<User | null> {
  const row = await one<{ user_id: string }>(
    "SELECT user_id FROM telegram_links WHERE chat_id = ?",
    [chatId],
  );
  return row ? getUserById(row.user_id) : null;
}

/** Remember which project this chat is asking about. */
export async function setActiveProject(chatId: number, projectId: string): Promise<void> {
  await run("UPDATE telegram_links SET active_project_id = ? WHERE chat_id = ?", [
    projectId,
    chatId,
  ]);
}

export async function getActiveProjectId(chatId: number): Promise<string | null> {
  const row = await one<{ active_project_id: string | null }>(
    "SELECT active_project_id FROM telegram_links WHERE chat_id = ?",
    [chatId],
  );
  return row?.active_project_id ?? null;
}

/** The Telegram chat_id linked to a user, if any (for outbound messages). */
export async function getChatIdForUser(userId: string): Promise<number | null> {
  const row = await one<{ chat_id: number }>(
    "SELECT chat_id FROM telegram_links WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return row ? Number(row.chat_id) : null;
}

export async function isTelegramLinked(userId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    "SELECT 1 AS n FROM telegram_links WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return !!row;
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await run("DELETE FROM telegram_links WHERE user_id = ?", [userId]);
}
