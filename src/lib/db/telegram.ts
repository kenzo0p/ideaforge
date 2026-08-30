import { randomBytes } from "node:crypto";
import { col } from "./index";
import { getUserById, type User } from "./users";

// ---------------------------------------------------------------------------
// Telegram account linking.
//
// A short-lived code generated in the app is sent to the bot (via a t.me deep
// link); the bot exchanges it to bind the Telegram chat to an Scrutan user.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 1000 * 60 * 15; // 15 minutes

/** `_id` is the chat id, so a chat can only ever map to one account. */
interface LinkDoc {
  _id: number;
  userId: string;
  activeProjectId: string | null;
  createdAt: number;
}

interface CodeDoc {
  _id: string;
  userId: string;
  /** Date so the TTL index reaps stale codes. */
  expiresAt: Date;
}

const links = () => col<LinkDoc>("telegramLinks");
const codes = () => col<CodeDoc>("telegramLinkCodes");

export async function createTelegramLinkCode(userId: string): Promise<{ code: string }> {
  const code = randomBytes(6).toString("hex"); // 12 chars, deep-link safe
  const c = await codes();
  await c.deleteMany({ userId });
  await c.insertOne({ _id: code, userId, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return { code };
}

/** Redeem a link code and bind the chat to its user. Returns the user or null. */
export async function linkTelegramChat(code: string, chatId: number): Promise<User | null> {
  // Single-use: read and delete in one step so a code can't be redeemed twice.
  const doc = await (await codes()).findOneAndDelete({ _id: code });
  if (!doc) return null;
  if (doc.expiresAt.getTime() < Date.now()) return null;

  await (await links()).replaceOne(
    { _id: chatId },
    { userId: doc.userId, activeProjectId: null, createdAt: Date.now() },
    { upsert: true },
  );
  return getUserById(doc.userId);
}

export async function getUserByChatId(chatId: number): Promise<User | null> {
  const doc = await (await links()).findOne({ _id: chatId });
  return doc ? getUserById(doc.userId) : null;
}

/** Remember which project this chat is asking about. */
export async function setActiveProject(chatId: number, projectId: string): Promise<void> {
  await (await links()).updateOne({ _id: chatId }, { $set: { activeProjectId: projectId } });
}

export async function getActiveProjectId(chatId: number): Promise<string | null> {
  const doc = await (await links()).findOne(
    { _id: chatId },
    { projection: { activeProjectId: 1 } },
  );
  return doc?.activeProjectId ?? null;
}

/** The Telegram chat_id linked to a user, if any (for outbound messages). */
export async function getChatIdForUser(userId: string): Promise<number | null> {
  const doc = await (await links()).findOne({ userId }, { projection: { _id: 1 } });
  return doc ? Number(doc._id) : null;
}

export async function isTelegramLinked(userId: string): Promise<boolean> {
  return (await (await links()).countDocuments({ userId }, { limit: 1 })) > 0;
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await (await links()).deleteMany({ userId });
}
