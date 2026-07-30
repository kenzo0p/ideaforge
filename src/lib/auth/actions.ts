"use server";

import { redirect } from "next/navigation";
import {
  createUser,
  createVerificationToken,
  getUserByEmail,
} from "@/lib/db/users";
import { sendVerificationEmail } from "@/lib/email/verification";
import { hashPassword, verifyPassword } from "./password";
import { endSession, startSession } from "./session";

export interface AuthState {
  error?: string;
  /** Set when sign-in is blocked because the email isn't verified yet. */
  needsVerification?: boolean;
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Issue a fresh token, email it, and route to the "check your inbox" page. */
async function startVerification(userId: string, email: string): Promise<void> {
  const { token } = await createVerificationToken(userId);
  const { delivered } = await sendVerificationEmail(email, token);
  const params = new URLSearchParams({ email });
  // Surface a fallback link whenever no real email went out (dev console mailer,
  // or a real send that failed — e.g. Resend test-mode recipient restriction).
  if (!delivered) params.set("dev", token);
  redirect(`/verify-email?${params.toString()}`); // throws NEXT_REDIRECT
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;

  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (await getUserByEmail(email)) return { error: "An account with that email already exists." };

  const user = await createUser(email, hashPassword(password), name);
  // No session yet — the account must be verified first (startVerification redirects).
  await startVerification(user.id, email);
  return {};
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await getUserByEmail(email);
  // Same message for missing user vs. wrong password (avoid account enumeration).
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid email or password." };
  }
  if (!user.emailVerified) {
    return {
      error: "Please verify your email before signing in.",
      needsVerification: true,
      email,
    };
  }

  await startSession(user.id);
  redirect("/dashboard");
}

/** Resend the verification email for an unverified account. */
export async function resendVerificationAction(email: string): Promise<AuthState> {
  const clean = email.trim().toLowerCase();
  const user = await getUserByEmail(clean);
  // Only (re)send for a real, still-unverified account; stay quiet otherwise.
  if (user && !user.emailVerified) {
    await startVerification(user.id, clean);
  }
  return { error: undefined };
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
