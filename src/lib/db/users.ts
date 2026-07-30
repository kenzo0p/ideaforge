import { randomBytes, randomUUID } from "node:crypto";
import { col } from "./index";

// ---------------------------------------------------------------------------
// Users + sessions repository
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** Preferred output language (BCP-47), or null to use the UI default. */
  locale: string | null;
  notificationsSeenAt: number;
  createdAt: number;
}

/** Shape stored in Mongo. `_id` is our own UUID. */
interface UserDoc {
  _id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  emailVerified: boolean;
  locale: string | null;
  notificationsSeenAt: number;
  createdAt: number;
}

/** Anything with a lifetime: `expiresAt` is a Date so the TTL index reaps it. */
interface TokenDoc {
  _id: string;
  userId: string;
  expiresAt: Date;
  createdAt: number;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour — reset links are shorter-lived

const users = () => col<UserDoc>("users");
const sessions = () => col<TokenDoc>("sessions");
const verificationTokens = () => col<TokenDoc>("verificationTokens");
const passwordResetTokens = () => col<TokenDoc>("passwordResetTokens");

function toUser(d: UserDoc): User {
  return {
    id: d._id,
    email: d.email,
    name: d.name ?? null,
    emailVerified: !!d.emailVerified,
    locale: d.locale ?? null,
    notificationsSeenAt: d.notificationsSeenAt ?? 0,
    createdAt: d.createdAt,
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  name?: string | null,
): Promise<User> {
  const now = Date.now();
  // New accounts start unverified.
  const doc: UserDoc = {
    _id: randomUUID(),
    email,
    name: name ?? null,
    passwordHash,
    emailVerified: false,
    locale: null,
    notificationsSeenAt: 0,
    createdAt: now,
  };
  await (await users()).insertOne(doc);
  return toUser(doc);
}

export async function markEmailVerified(userId: string): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { emailVerified: true } });
}

/** Mark the notifications inbox as read up to now. */
export async function markNotificationsSeen(userId: string): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { notificationsSeenAt: Date.now() } });
}

export async function updateUserLocale(userId: string, locale: string): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { locale } });
}

export async function updateUserName(userId: string, name: string | null): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { name } });
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await (await users()).updateOne({ _id: userId }, { $set: { passwordHash } });
  // Force re-auth everywhere after a password change.
  await (await sessions()).deleteMany({ userId });
}

/**
 * Hard-delete the account and everything hanging off it.
 *
 * SQLite did this with ON DELETE CASCADE. Mongo has no foreign keys, so the
 * cascade is explicit — every collection referencing a user is listed here.
 * Add to this list whenever a new user-owned collection appears.
 */
export async function deleteUser(userId: string): Promise<void> {
  const owned = [
    "projects",
    "sessions",
    "verificationTokens",
    "passwordResetTokens",
    "reminders",
    "reminderLogs",
    "telegramLinks",
    "telegramLinkCodes",
    "rateHits",
  ];
  await Promise.all(
    owned.map(async (name) => (await col(name)).deleteMany({ userId })),
  );
  await (await users()).deleteOne({ _id: userId });
}

// --- Email verification tokens ---------------------------------------------

export async function createVerificationToken(userId: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const c = await verificationTokens();
  // One outstanding token per user: clear any prior ones first.
  await c.deleteMany({ userId });
  await c.insertOne({
    _id: token,
    userId,
    expiresAt: new Date(now + VERIFY_TTL_MS),
    createdAt: now,
  });
  return { token };
}

// --- Password reset tokens -------------------------------------------------

export async function createPasswordResetToken(userId: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const c = await passwordResetTokens();
  // One outstanding reset per user.
  await c.deleteMany({ userId });
  await c.insertOne({
    _id: token,
    userId,
    expiresAt: new Date(now + RESET_TTL_MS),
    createdAt: now,
  });
  return { token };
}

/** Validate a reset token without consuming it (for rendering the form). */
export async function peekPasswordResetToken(token: string): Promise<string | null> {
  const doc = await (await passwordResetTokens()).findOne({ _id: token });
  // TTL sweeps run about once a minute, so still check the deadline ourselves.
  if (!doc || doc.expiresAt.getTime() < Date.now()) return null;
  return doc.userId;
}

/** Consume a reset token: returns the userId if valid, else null. */
export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const userId = await peekPasswordResetToken(token);
  await (await passwordResetTokens()).deleteOne({ _id: token });
  return userId;
}

/** Consume a verification token: returns the userId if valid, else null. */
export async function consumeVerificationToken(token: string): Promise<string | null> {
  const doc = await (await verificationTokens()).findOneAndDelete({ _id: token });
  if (!doc) return null;
  if (doc.expiresAt.getTime() < Date.now()) return null;
  return doc.userId;
}

export async function getUserByEmail(
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  const d = await (await users()).findOne({ email });
  return d ? { ...toUser(d), passwordHash: d.passwordHash } : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const d = await (await users()).findOne({ _id: id });
  return d ? toUser(d) : null;
}

// --- Sessions ---------------------------------------------------------------

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await (await sessions()).insertOne({
    _id: token,
    userId,
    expiresAt: new Date(expiresAt),
    createdAt: now,
  });
  return { token, expiresAt };
}

/** Resolve a session token to its user, clearing it if expired. */
export async function getUserForSession(token: string): Promise<User | null> {
  const doc = await (await sessions()).findOne({ _id: token });
  if (!doc) return null;
  if (doc.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return getUserById(doc.userId);
}

export async function destroySession(token: string): Promise<void> {
  await (await sessions()).deleteOne({ _id: token });
}
