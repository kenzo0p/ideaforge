"use server";

import { cookies } from "next/headers";

const COOKIE = "ideaforge_onboarded";

/** Remember that the checklist was dismissed, so it stays dismissed. */
export async function dismissOnboardingAction(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "1", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function isOnboardingDismissed(): Promise<boolean> {
  return (await cookies()).get(COOKIE)?.value === "1";
}
