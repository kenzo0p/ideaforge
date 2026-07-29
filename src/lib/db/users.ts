import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./index";

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

export function createUser(email: string, passwordHash: string, name?: string | null): User {
  const id = randomUUID();
  const now = Date.now();
  // New accounts start unverified (email_verified defaults to 0).
  getDb()
    .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, name ?? null, passwordHash, now);
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

export function markEmailVerified(userId: string): void {
  getDb().prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}

/** Mark the notifications inbox as read up to now. */
export function markNotificationsSeen(userId: string): void {
  getDb().prepare("UPDATE users SET notifications_seen_at = ? WHERE id = ?").run(Date.now(), userId);
}

export function updateUserLocale(userId: string, locale: string): void {
  getDb().prepare("UPDATE users SET locale = ? WHERE id = ?").run(locale, userId);
}

export function updateUserName(userId: string, name: string | null): void {
  getDb().prepare("UPDATE users SET name = ? WHERE id = ?").run(name, userId);
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  const db = getDb();
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  // Force re-auth everywhere after a password change.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Hard-delete the account; cascades remove projects, reminders, links, etc. */
export function deleteUser(userId: string): void {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
}

// --- Email verification tokens ---------------------------------------------

export function createVerificationToken(userId: string): { token: string } {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const db = getDb();
  // One outstanding token per user: clear any prior ones first.
  db.prepare("DELETE FROM verification_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    "INSERT INTO verification_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now + VERIFY_TTL_MS, now);
  return { token };
}

/** Consume a verification token: returns the userId if valid, else null. */
export function consumeVerificationToken(token: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT user_id, expires_at FROM verification_tokens WHERE token = ?")
    .get(token) as { user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM verification_tokens WHERE token = ?").run(token);
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const r = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
}

export function getUserById(id: string): User | null {
  const r = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

// --- Sessions --------------------------------------------------------------

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now, expiresAt);
  return { token, expiresAt };
}

/** Resolve a session token to its user, clearing it if expired. */
export function getUserForSession(token: string): User | null {
  const row = getDb().prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(token) as
    | { user_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return getUserById(row.user_id);
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(token);
}
