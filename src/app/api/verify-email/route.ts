import { NextResponse } from "next/server";
import { consumeVerificationToken, createSession, markEmailVerified } from "@/lib/db/users";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

// GET /api/verify-email?token=… — the link from the verification email.
// Verifies the account, starts a session, and lands the user on the dashboard.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/sign-in?verify=invalid", req.url));
  }

  const userId = consumeVerificationToken(token);
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in?verify=expired", req.url));
  }

  markEmailVerified(userId);
  const { token: sessionToken } = createSession(userId);

  const res = NextResponse.redirect(new URL("/dashboard?verified=1", req.url));
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return res;
}
