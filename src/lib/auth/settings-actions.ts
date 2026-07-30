"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  deleteUser,
  getUserByEmail,
  updateUserLocale,
  updateUserName,
  updateUserPassword,
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
  if (!full || !verifyPassword(current, full.passwordHash)) {
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
  if (!full || !verifyPassword(password, full.passwordHash)) {
    return { error: "Password is incorrect." };
  }

  await endSession();
  await deleteUser(user.id); // cascades: projects, workspace items, reminders, links
  redirect("/");
}
