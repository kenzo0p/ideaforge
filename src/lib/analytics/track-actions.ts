"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";

/**
 * Record an upgrade-prompt impression or click from the browser.
 *
 * A narrow server action rather than a general "track anything" endpoint: an
 * open tracking API lets anyone POST arbitrary events and poison the funnel the
 * business is steered by. Only these two names are accepted, and the user comes
 * from the session, never from the caller.
 */
export async function trackUpgradePromptAction(
  kind: "shown" | "clicked",
  limit: string,
): Promise<void> {
  const user = await getCurrentUser();
  void track(
    kind === "shown" ? EVENTS.UPGRADE_PROMPT_SHOWN : EVENTS.UPGRADE_PROMPT_CLICKED,
    { userId: user?.id, props: { limit: limit.slice(0, 60) } },
  );
}
