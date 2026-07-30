import { cookies } from "next/headers";
import {
  createSession,
  destroySession,
  getUserForSession,
  type User,
} from "@/lib/db/users";

// Session cookie management. Opaque token in an HttpOnly cookie; the token maps
// to a row in the `sessions` table (see db/users.ts).

export const SESSION_COOKIE = "ideaforge_session";
const COOKIE = SESSION_COOKIE;
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)

/** Cookie options shared by every place that sets the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  };
}

/** Create a session for a user and set the cookie. */
export async function startSession(userId: string): Promise<void> {
  const { token } = await createSession(userId);
  const jar = await cookies();
  jar.set(COOKIE, token, sessionCookieOptions());
}

/** Clear the current session (DB row + cookie). */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Safe to call from server components/actions. */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return await getUserForSession(token);
}
