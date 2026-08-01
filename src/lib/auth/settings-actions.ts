"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { normalizeUsername, validateUsername } from "@/lib/username";
import {
  deleteUser,
  getUserByEmail,
  updateUserLocale,
  updateUserName,
  updateUserPassword,
  updateUsername,
} from "@/lib/db/users";
import { hashPassword, verifyPassword } from "./password";
import { endSession, getCurrentUser } from "./session";

export interface SettingsState {
  error?: string;
  success?: string;
}

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function updateProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim() || null;
  const locale = String(formData.get("locale") ?? "en").trim();
  const username = String(formData.get("username") ?? "").trim();

  // The handle is how teammates find you, so it changes only when it's valid
  // and free — and the save is rejected rather than silently partial.
  if (username && normalizeUsername(username) !== user.username) {
    const invalid = validateUsername(username);
    if (invalid) return { error: invalid };
    if (!(await updateUsername(user.id, username))) {
      return { error: `@${normalizeUsername(username)} is already taken.` };
    }
  }

  await updateUserName(user.id, name);
  await updateUserLocale(user.id, locale);
  revalidatePath("/settings");
  return { success: "Profile updated." };
}

export async function changePasswordAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };

  const full = await getUserByEmail(user.email);
  // A Google-only account has no current password to prove. Sending them to the
  // reset flow is the safe route — it re-proves ownership over email.
  if (full && !full.passwordHash) {
    return {
      error:
        "This account signs in with Google and has no password yet. Use “Forgot password?” on the sign-in page to set one.",
    };
  }
  if (!full?.passwordHash || !verifyPassword(current, full.passwordHash)) {
    return { error: "Current password is incorrect." };
  }

  // Invalidates every session, including this one — send the user back to sign in.
  await updateUserPassword(user.id, hashPassword(next));
  redirect("/sign-in?changed=1");
}

export async function deleteAccountAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (confirm !== "DELETE") return { error: 'Type DELETE to confirm.' };

  const full = await getUserByEmail(user.email);
  if (!full) return { error: "Password is incorrect." };
  // Google-only accounts can't be asked for a password, so typing DELETE is the
  // whole confirmation. They already proved identity to reach this page.
  if (full.passwordHash && !verifyPassword(password, full.passwordHash)) {
    return { error: "Password is incorrect." };
  }

  await endSession();
  await deleteUser(user.id); // cascades: projects, workspace items, reminders, links
  redirect("/");
}
