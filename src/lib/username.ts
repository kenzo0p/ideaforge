// ---------------------------------------------------------------------------
// Usernames — the handle people are invited by.
//
// Email was the wrong key for collaboration: it's private, it's awkward to type
// from memory, and it tied invitations to a mail provider. A handle is public,
// memorable, and works entirely inside the app.
// ---------------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Handles that would be confusing or that collide with routes. */
const RESERVED = new Set([
  "admin", "root", "system", "ideaforge", "support", "help", "api", "app",
  "settings", "dashboard", "projects", "notifications", "sign-in", "sign-up",
  "invite", "share", "me", "you", "null", "undefined", "anonymous",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

/** Returns an error message, or null when the handle is acceptable. */
export function validateUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (u.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters.`;
  if (!/^[a-z0-9_]+$/.test(u)) return "Use only letters, numbers and underscores.";
  if (!/^[a-z]/.test(u)) return "Username must start with a letter.";
  if (RESERVED.has(u)) return "That username is reserved.";
  return null;
}

/**
 * A starting handle derived from a name or email.
 *
 * Only a suggestion — the caller must still resolve collisions, because two
 * people called "Alex Kim" will both land on `alexkim`.
 */
export function suggestUsername(nameOrEmail: string): string {
  const base = normalizeUsername(nameOrEmail.split("@")[0])
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "");
  const trimmed = base.slice(0, USERNAME_MAX);
  // Pad rather than return something too short to pass validation.
  return trimmed.length >= USERNAME_MIN ? trimmed : `${trimmed}user`.slice(0, USERNAME_MAX);
}
