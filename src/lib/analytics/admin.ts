import { getCurrentUser } from "@/lib/auth/session";

/**
 * Who may see the analytics dashboard.
 *
 * A comma-separated list of usernames in ADMIN_USERNAMES. Deliberately not a
 * database flag: a role column is one bad UPDATE away from privilege
 * escalation, whereas changing this requires deploy access, which whoever
 * should see revenue numbers already has.
 *
 * Unset means nobody — the dashboard 404s rather than defaulting to open.
 */
export function adminUsernames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export async function isAdmin(): Promise<boolean> {
  const allowed = adminUsernames();
  if (allowed.length === 0) return false;
  const user = await getCurrentUser();
  return !!user && allowed.includes(user.username.toLowerCase());
}
