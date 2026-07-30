"use server";

import { redirect } from "next/navigation";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  getUserByEmail,
  updateUserPassword,
} from "@/lib/db/users";
import { sendPasswordResetEmail } from "@/lib/email/verification";
import { hashPassword } from "./password";

export interface ResetState {
  error?: string;
  sent?: boolean;
  /** Surfaced only when no real email could be delivered (dev / test mode). */
  devToken?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Start a reset. Always reports success so the response can't be used to probe
 * which email addresses have accounts.
 */
export async function requestPasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };

  const user = await getUserByEmail(email);
  if (!user) return { sent: true }; // don't reveal non-existence

  const { token } = await createPasswordResetToken(user.id);
  const { delivered } = await sendPasswordResetEmail(email, token);
  return { sent: true, devToken: delivered ? undefined : token };
}

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const userId = await consumePasswordResetToken(token);
  if (!userId) return { error: "This reset link is invalid or has expired. Request a new one." };

  // Also clears every existing session for that user.
  await updateUserPassword(userId, hashPassword(password));
  redirect("/sign-in?reset=1");
}
