"use server";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/db/ratelimit";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyExternal, MAX_SOURCES, type ExternalReport } from "@/lib/verify/external";

// ---------------------------------------------------------------------------
// The public check.
//
// This is the only surface in the product that fetches URLs for someone who is
// not signed in, which makes it the only one where the caller is a stranger.
// Two things follow, and both are load-bearing:
//
//   • Every fetch goes through the address guard in verify/safe-fetch.ts, so a
//     pasted URL cannot reach the metadata service or anything else inside the
//     network. That is enforced there rather than here, so it holds for every
//     caller rather than for the ones that remembered.
//
//   • The work is bounded per caller. A check opens up to twelve pages, so an
//     unbounded endpoint is a way to point our egress at somebody's server.
// ---------------------------------------------------------------------------

/** Anonymous callers get a tighter budget than signed-in ones. */
const ANON_LIMIT = 3;
const USER_LIMIT = 15;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Who to count this against.
 *
 * A signed-in user is counted by id, which survives a change of network. An
 * anonymous one is counted by forwarded IP, which is imperfect — a shared
 * campus NAT is one bucket for everybody behind it — and is the only stable
 * handle available. The tighter anonymous limit is partly because of that:
 * getting it wrong should inconvenience someone briefly, not hand out a large
 * budget to whoever is behind the same router.
 */
async function callerKey(): Promise<{ key: string; limit: number; anonymous: boolean }> {
  const user = await getCurrentUser();
  if (user) return { key: `user:${user.id}`, limit: USER_LIMIT, anonymous: false };

  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || "unknown";
  return { key: `ip:${ip}`, limit: ANON_LIMIT, anonymous: true };
}

export interface VerifyExternalResult {
  report?: ExternalReport;
  error?: string;
  retryAfterSec?: number;
}

export async function verifyExternalAction(
  text: string,
  sourceList: string,
): Promise<VerifyExternalResult> {
  const answer = text.trim();
  if (answer.length < 40) {
    return { error: "Paste the answer you want checked — at least a couple of sentences." };
  }

  const urls = sourceList
    .split(/[\n,\s]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    return { error: "Add the sources the answer cited, one URL per line." };
  }
  if (!/\[\d+\]/.test(answer)) {
    return {
      error:
        "The answer needs [1]-style markers so each sentence can be matched to the source it cited. " +
        "Most tools include them; if yours does not, add them by hand.",
    };
  }

  const { key, limit, anonymous } = await callerKey();
  const rate = await checkRateLimit(key, "verify-external", limit, WINDOW_MS);
  if (!rate.ok) {
    return {
      error: anonymous
        ? `That is ${limit} checks in an hour from this connection. Sign in for a higher limit.`
        : `That is ${limit} checks in an hour. Try again shortly.`,
      retryAfterSec: rate.retryAfterSec,
    };
  }

  try {
    const report = await verifyExternal({ text: answer, urls: urls.slice(0, MAX_SOURCES * 2) });
    return { report };
  } catch (err) {
    console.error("External verification failed:", err instanceof Error ? err.message : err);
    return { error: "Something went wrong reading those sources. Try again in a moment." };
  }
}
