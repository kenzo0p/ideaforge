import { NextResponse } from "next/server";
import { consumeVerificationToken, createSession, markEmailVerified } from "@/lib/db/users";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { publicUrl } from "@/lib/http/origin";

export const runtime = "nodejs";

// GET /api/verify-email?token=… — the link from the verification email.
// Verifies the account, starts a session, and lands the user on the dashboard.
//
// Redirect targets come from the forwarded headers, not `req.url`: behind
// Render's proxy the latter is http://localhost:10000, so a redirect built from
// it bounces the visitor to a dead address on their own machine.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(await publicUrl("/sign-in?verify=invalid"));
  }

  const userId = await consumeVerificationToken(token);
  if (!userId) {
    return NextResponse.redirect(await publicUrl("/sign-in?verify=expired"));
  }

  await markEmailVerified(userId);
  const { token: sessionToken } = await createSession(userId);

  const res = NextResponse.redirect(await publicUrl("/dashboard?verified=1"));
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return res;
}
