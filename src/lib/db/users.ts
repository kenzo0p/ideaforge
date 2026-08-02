import { randomBytes, randomUUID } from "node:crypto";
import { col } from "./index";
import { normalizeUsername, suggestUsername, USERNAME_MAX } from "@/lib/username";

// ---------------------------------------------------------------------------
// Users + sessions repository
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  /** Unique handle used to invite people — the public identifier, not email. */
  username: string;
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
  /** Stored lowercase; the unique index is on this field. */
  username: string;
  name: string | null;
  /** Absent for accounts created purely through Google — there is no password. */
  passwordHash?: string;
  emailVerified: boolean;
  locale: string | null;
  notificationsSeenAt: number;
  createdAt: number;
  /** Firebase uid, set once the account has signed in with Google. */
  googleUid?: string;
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
    // Accounts created before usernames existed fall back to the local part of
    // their email so the UI never renders an empty handle.
    username: d.username ?? d.email.split("@")[0],
    name: d.name ?? null,
    emailVerified: !!d.emailVerified,
    locale: d.locale ?? null,
    notificationsSeenAt: d.notificationsSeenAt ?? 0,
    createdAt: d.createdAt,
  };
}

/**
 * Claim a free handle near `desired`.
 *
 * Appends a counter on collision. Racy in principle — two signups could pick
 * the same handle between the check and the insert — which is why the unique
 * index on `username` is the real guarantee and insert failures retry.
 */
export async function allocateUsername(desired: string): Promise<string> {
  const c = await users();
  const base = suggestUsername(desired);
  if (!(await c.countDocuments({ username: base }, { limit: 1 }))) return base;

  for (let n = 2; n < 200; n++) {
    const candidate = `${base.slice(0, USERNAME_MAX - String(n).length)}${n}`;
    if (!(await c.countDocuments({ username: candidate }, { limit: 1 }))) return candidate;
  }
  // Pathological case: fall back to something that cannot realistically clash.
  return `${base.slice(0, 12)}${Date.now().toString(36).slice(-6)}`;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const d = await (await users()).findOne({ username: normalizeUsername(username) });
  return d ? toUser(d) : null;
}

export async function isUsernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
  const filter: Record<string, unknown> = { username: normalizeUsername(username) };
  if (exceptUserId) filter._id = { $ne: exceptUserId };
  return (await (await users()).countDocuments(filter, { limit: 1 })) > 0;
}

/** Change a handle. Returns false when it's already taken. */
export async function updateUsername(userId: string, username: string): Promise<boolean> {
  const clean = normalizeUsername(username);
  if (await isUsernameTaken(clean, userId)) return false;
  try {
    await (await users()).updateOne({ _id: userId }, { $set: { username: clean } });
    return true;
  } catch {
    // Unique index rejected it — someone claimed it in between.
    return false;
  }
}

/** Handle search for the invite box. Prefix match, excluding the searcher. */
export async function searchUsers(query: string, excludeUserId: string, limit = 5): Promise<User[]> {
  const q = normalizeUsername(query);
  if (q.length < 2) return [];
  // Escape so a user typing regex characters can't craft an expensive pattern.
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const docs = await (await users())
    .find({ username: { $regex: `^${safe}` }, _id: { $ne: excludeUserId } })
    .limit(limit)
    .toArray();
  return docs.map(toUser);
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
    username: await allocateUsername(name || email),
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
    "projectComments",
    "integrations",
    "oauthStates",
  ];
  await Promise.all(
    owned.map(async (name) => (await col(name)).deleteMany({ userId })),
  );
  // Collaboration leaves traces on *other people's* projects: membership on
  // theirs, and invitations addressed to this email. Neither is keyed by userId,
  // so neither is covered by the loop above.
  const user = await (await users()).findOne({ _id: userId }, { projection: { email: 1 } });
  await (await col<{ members?: { userId: string }[] }>("projects")).updateMany(
    { "members.userId": userId },
    { $pull: { members: { userId } } },
  );
  if (user?.email) {
    await (await col("projectInvites")).deleteMany({ email: user.email });
  }

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
): Promise<(User & { passwordHash: string | null }) | null> {
  const d = await (await users()).findOne({ email });
  return d ? { ...toUser(d), passwordHash: d.passwordHash ?? null } : null;
}

/**
 * Find or create the account behind a verified Google identity.
 *
 * Linking rule: we attach to an existing account with the same address only
 * when Google says it verified that address. Without that check, anyone able to
 * mint a token for an unverified address could seize the matching password
 * account — the classic OAuth pre-hijack. The caller enforces it too; this is
 * defence in depth.
 *
 * Accounts arriving this way are verified on the spot: Google already proved
 * ownership, so there is no confirmation email to send.
 */
export async function upsertGoogleUser(identity: {
  uid: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}): Promise<User> {
  if (!identity.emailVerified) {
    throw new Error("Refusing to link a Google identity with an unverified email.");
  }
  const c = await users();
  const existing = await c.findOne({ email: identity.email });

  if (existing) {
    // Adopt the Google uid, and treat the address as verified from now on.
    await c.updateOne(
      { _id: existing._id },
      {
        $set: {
          googleUid: identity.uid,
          emailVerified: true,
          // Only fill a blank name; never overwrite one the user chose.
          ...(existing.name ? {} : { name: identity.name }),
        },
      },
    );
    return toUser({
      ...existing,
      googleUid: identity.uid,
      emailVerified: true,
      name: existing.name ?? identity.name,
    });
  }

  // Brand-new, password-less account.
  const doc: UserDoc = {
    _id: randomUUID(),
    email: identity.email,
    username: await allocateUsername(identity.name || identity.email),
    name: identity.name,
    emailVerified: true,
    locale: null,
    notificationsSeenAt: 0,
    createdAt: Date.now(),
    googleUid: identity.uid,
  };
  await c.insertOne(doc);
  return toUser(doc);
}

/** Whether this account can sign in with a password at all. */
export async function hasPassword(userId: string): Promise<boolean> {
  const d = await (await users()).findOne({ _id: userId }, { projection: { passwordHash: 1 } });
  return !!d?.passwordHash;
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
