import { randomBytes, randomUUID } from "node:crypto";
import { one, run } from "./index";

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
  /** Watermark for unread notifications. */
  notificationsSeenAt: number;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  email_verified: number;
  locale: string | null;
  notifications_seen_at: number;
  created_at: number;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour — reset links are shorter-lived

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    emailVerified: !!r.email_verified,
    locale: r.locale,
    notificationsSeenAt: r.notifications_seen_at ?? 0,
    createdAt: r.created_at,
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  name?: string | null,
): Promise<User> {
  const id = randomUUID();
  const now = Date.now();
  // New accounts start unverified (email_verified defaults to 0).
  await run(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, email, name ?? null, passwordHash, now],
  );
  return {
    id,
    email,
    name: name ?? null,
    emailVerified: false,
    locale: null,
    notificationsSeenAt: 0,
    createdAt: now,
  };
}

export async function markEmailVerified(userId: string): Promise<void> {
  await run("UPDATE users SET email_verified = 1 WHERE id = ?", [userId]);
}

/** Mark the notifications inbox as read up to now. */
export async function markNotificationsSeen(userId: string): Promise<void> {
  await run("UPDATE users SET notifications_seen_at = ? WHERE id = ?", [Date.now(), userId]);
}

export async function updateUserLocale(userId: string, locale: string): Promise<void> {
  await run("UPDATE users SET locale = ? WHERE id = ?", [locale, userId]);
}

export async function updateUserName(userId: string, name: string | null): Promise<void> {
  await run("UPDATE users SET name = ? WHERE id = ?", [name, userId]);
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
  // Force re-auth everywhere after a password change.
  await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

/** Hard-delete the account; cascades remove projects, reminders, links, etc. */
export async function deleteUser(userId: string): Promise<void> {
  await run("DELETE FROM users WHERE id = ?", [userId]);
}

// --- Email verification tokens ---------------------------------------------

export async function createVerificationToken(userId: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  // One outstanding token per user: clear any prior ones first.
  await run("DELETE FROM verification_tokens WHERE user_id = ?", [userId]);
  await run(
    "INSERT INTO verification_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [token, userId, now + VERIFY_TTL_MS, now],
  );
  return { token };
}

// --- Password reset tokens -------------------------------------------------

export async function createPasswordResetToken(userId: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  // One outstanding reset per user.
  await run("DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
  await run(
    "INSERT INTO password_reset_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [token, userId, now + RESET_TTL_MS, now],
  );
  return { token };
}

/** Validate a reset token without consuming it (for rendering the form). */
export async function peekPasswordResetToken(token: string): Promise<string | null> {
  const row = await one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ?",
    [token],
  );
  if (!row || row.expires_at < Date.now()) return null;
  return row.user_id;
}

/** Consume a reset token: returns the userId if valid, else null. */
export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const userId = await peekPasswordResetToken(token);
  await run("DELETE FROM password_reset_tokens WHERE token = ?", [token]);
  return userId;
}

/** Consume a verification token: returns the userId if valid, else null. */
export async function consumeVerificationToken(token: string): Promise<string | null> {
  const row = await one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM verification_tokens WHERE token = ?",
    [token],
  );
  if (!row) return null;
  await run("DELETE FROM verification_tokens WHERE token = ?", [token]);
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}

export async function getUserByEmail(
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  const r = await one<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
  return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const r = await one<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return r ? toUser(r) : null;
}

// --- Sessions --------------------------------------------------------------

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
    token,
    userId,
    now,
    expiresAt,
  ]);
  return { token, expiresAt };
}

/** Resolve a session token to its user, clearing it if expired. */
export async function getUserForSession(token: string): Promise<User | null> {
  const row = await one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM sessions WHERE id = ?",
    [token],
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await destroySession(token);
    return null;
  }
  return getUserById(row.user_id);
}

export async function destroySession(token: string): Promise<void> {
  await run("DELETE FROM sessions WHERE id = ?", [token]);
}
