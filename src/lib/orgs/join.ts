import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { autoJoinByDomain } from "@/lib/db/orgs";
import { getUserById } from "@/lib/db/users";

/**
 * Put a user into their institution's workspace if one has claimed their domain.
 *
 * Hooked into session creation rather than sign-up, so it runs on every way in —
 * password, Google, and the redirect after email verification. That also means
 * an institution buying a workspace *after* its students have signed up picks
 * them up on their next sign-in, instead of the admin having to chase everyone
 * for an invitation.
 *
 * Never throws and is never awaited by the caller: nobody should fail to sign in
 * because a workspace lookup had a bad day.
 */
export async function attachToOrgOnLogin(userId: string): Promise<void> {
  try {
    const user = await getUserById(userId);
    // Unverified addresses are not evidence of belonging anywhere — anyone can
    // type a university address into the sign-up form.
    if (!user?.email || !user.emailVerified) return;

    const outcome = await autoJoinByDomain(userId, user.email);
    if (outcome.joined) {
      void track(EVENTS.ORG_MEMBER_JOINED, {
        userId,
        props: { via: "domain", plan: outcome.org.planId },
      });
    }
  } catch (err) {
    console.error("Org auto-join failed:", err instanceof Error ? err.message : err);
  }
}
