import { randomBytes } from "node:crypto";
import { getDb } from "./index";
import { getUserById, type User } from "./users";

// ---------------------------------------------------------------------------
// Telegram account linking.
//
// A short-lived code generated in the app is sent to the bot (via a t.me deep
// link); the bot exchanges it to bind the Telegram chat to an IdeaForge user.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 1000 * 60 * 15; // 15 minutes

export function createTelegramLinkCode(userId: string): { code: string } {
  const code = randomBytes(6).toString("hex"); // 12 chars, deep-link safe
  const db = getDb();
  db.prepare("DELETE FROM telegram_link_codes WHERE user_id = ?").run(userId);
  db.prepare(
    "INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(code, userId, Date.now() + CODE_TTL_MS);
  return { code };
}

/** Redeem a link code and bind the chat to its user. Returns the user or null. */
export function linkTelegramChat(code: string, chatId: number): User | null {
  const db = getDb();
  const row = db
    .prepare("SELECT user_id, expires_at FROM telegram_link_codes WHERE code = ?")
    .get(code) as { user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM telegram_link_codes WHERE code = ?").run(code);
  if (row.expires_at < Date.now()) return null;

  db.prepare(
    "INSERT OR REPLACE INTO telegram_links (chat_id, user_id, created_at) VALUES (?, ?, ?)",
  ).run(chatId, row.user_id, Date.now());
  return getUserById(row.user_id);
}

export function getUserByChatId(chatId: number): User | null {
  const row = getDb()
    .prepare("SELECT user_id FROM telegram_links WHERE chat_id = ?")
    .get(chatId) as { user_id: string } | undefined;
  return row ? getUserById(row.user_id) : null;
}

/** The Telegram chat_id linked to a user, if any (for outbound messages). */
export function getChatIdForUser(userId: string): number | null {
  const row = getDb()
    .prepare("SELECT chat_id FROM telegram_links WHERE user_id = ? LIMIT 1")
    .get(userId) as { chat_id: number } | undefined;
  return row ? row.chat_id : null;
}

export function isTelegramLinked(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM telegram_links WHERE user_id = ? LIMIT 1")
    .get(userId);
  return !!row;
}

export function unlinkTelegram(userId: string): void {
  getDb().prepare("DELETE FROM telegram_links WHERE user_id = ?").run(userId);
}
