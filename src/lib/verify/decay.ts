import { saveGrounding, staleGrounding, type StoredGrounding } from "@/lib/db/grounding";
import { getClaims } from "@/lib/db/claims";
import { getSnapshots, saveSnapshots } from "@/lib/db/snapshots";
import { detectDrift, driftMessage, fingerprint, type CapturedPage } from "./evidence";
import { assessIndependence } from "./independence";
import { logReminderSent } from "@/lib/db/reminders";
import { getChatIdForUser } from "@/lib/db/telegram";
import { sendTelegramMessage } from "@/lib/agents/telegram";
import { hostnameOf } from "@/lib/search/types";
import { verifyCitations } from "./citations";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Link rot.
//
// Verification is a measurement, and a measurement has a date. A brief checked
// in March and read in October carries a number that describes March — which
// is the same failure as an uncited claim, one level up: a confident figure
// nobody has any reason to still believe.
//
// So the checks are re-run on a schedule and the result is compared to what it
// was. What comes out is the sentence this product is for: *three of the twelve
// sources behind this brief have died since you wrote it.*
//
// This is also the part that makes the product recurring rather than one-off.
// The natural usage pattern for idea validation is intense-then-idle; a brief
// that quietly degrades is a reason to come back that does not depend on the
// user remembering to.
// ---------------------------------------------------------------------------

/**
 * How long a check stands before it is worth repeating.
 *
 * A month is a compromise between two real costs. Shorter and we are hammering
 * other people's servers to detect something that changes slowly; longer and
 * the number on a shared brief is stale for most of its readable life.
 */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Projects re-checked per cron tick.
 *
 * Small on purpose. Each one fans out to every host it cited, and the staleness
 * cut-off already bounds the long-run total — this only bounds the burst.
 */
const MAX_PER_RUN = 3;

/**
 * Rebuild the citation list from the stored verdicts.
 *
 * Deliberately not read from the project's current research. The question this
 * pass answers is "are the sources this brief was built on still there?", and
 * re-reading current research would silently change the subject to a different
 * set of sources whenever research had been re-run in between.
 */
function citationsFrom(stored: StoredGrounding): Citation[] {
  return stored.verdicts.map((v) => ({
    id: v.id,
    title: v.title,
    url: v.url,
    source: hostnameOf(v.url),
  }));
}

function rotMessage(projectTitle: string, count: number, total: number): string {
  const s = count === 1 ? "source has" : "sources have";
  return `${count} of the ${total} ${s} stopped resolving since this brief was verified: "${projectTitle}". The grounding score has been updated.`;
}

/**
 * Re-verify the stalest stored checks. Returns how many were re-checked.
 *
 * Runs from the same scheduler as reminders and watches. Failures are per
 * project: one unreachable corner of the internet must not stop the rest of
 * the pass, and a pass that throws would leave every later project permanently
 * stale because its `checkedAt` never advances.
 */
export async function runDueRevalidations(): Promise<number> {
  let due;
  try {
    due = await staleGrounding(Date.now() - STALE_AFTER_MS, MAX_PER_RUN);
  } catch (err) {
    console.error("Stale-grounding query failed:", err instanceof Error ? err.message : err);
    return 0;
  }

  let checked = 0;
  for (const { projectId, userId, stored } of due) {
    try {
      const citations = citationsFrom(stored);
      if (citations.length === 0) continue;

      // The pages are captured on the way past, so the fingerprint comparison
      // costs no extra requests: one fetch answers both "does it resolve?" and
      // "is it still the same page?".
      const pages: CapturedPage[] = [];
      const report = await verifyCitations(citations, (citation, text) => {
        pages.push({ citation, text });
      });
      checked++;

      const drift = await compareEvidence(projectId, userId, pages);
      const text = new Map(pages.map((p) => [p.citation.id, p.text]));
      const independence = assessIndependence(
        citations.map((citation) => ({ citation, text: text.get(citation.id) ?? "" })),
      );
      const saved = await saveGrounding(projectId, userId, report, drift, independence);

      // Only newly-observed rot is worth interrupting someone for. Sources that
      // were already known to be dead are not news, and re-announcing them every
      // month is how a useful alert becomes one people mute.
      const fresh = saved.rotted.filter((r) => r.noticedAt >= report.checkedAt);

      // Two findings, and the second is the sharper one. A source that stopped
      // resolving is a dead link; a source that still resolves but has lost the
      // passage it was cited for is a claim that has quietly become unfounded,
      // which nothing else in this product would ever notice.
      const drifted = driftMessage("", drift);
      if (fresh.length === 0 && !drifted) continue;

      await notify(projectId, userId, {
        rotted: fresh.length,
        total: report.verdicts.length,
        drift,
      });
    } catch (err) {
      console.error(
        `Re-verification failed for project ${projectId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return checked;
}

/**
 * Fingerprint what was just read, and compare it with what was stored.
 *
 * Failures here are swallowed on purpose. Drift is an enhancement to the decay
 * pass; if the comparison cannot be made, the pass should still deliver the
 * link-rot result it was always able to deliver.
 */
async function compareEvidence(
  projectId: string,
  userId: string,
  pages: CapturedPage[],
) {
  if (pages.length === 0) return [];
  try {
    const [previous, claims] = await Promise.all([
      getSnapshots(projectId),
      getClaims(projectId),
    ]);
    const drift = detectDrift({ pages, previous, claims: claims?.verdicts ?? [] });
    await saveSnapshots(projectId, userId, pages.map((page) => fingerprint(projectId, page)));
    return drift;
  } catch (err) {
    console.error("Evidence comparison failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Tell the owner, in the inbox they already have.
 *
 * Reuses the notification log rather than introducing a second kind of
 * notification with its own page, badge and unread rule — two inboxes is how
 * one of them stops being read.
 */
async function notify(
  projectId: string,
  userId: string,
  found: { rotted: number; total: number; drift: Awaited<ReturnType<typeof compareEvidence>> },
): Promise<void> {
  const { getProject } = await import("@/lib/db/projects");
  const project = await getProject(projectId, userId);
  if (!project) return;

  const parts = [
    found.rotted > 0 ? rotMessage(project.title, found.rotted, found.total) : null,
    driftMessage(project.title, found.drift),
  ].filter(Boolean);
  if (parts.length === 0) return;
  const message = parts.join(" ");

  let delivered = false;
  const chatId = await getChatIdForUser(userId).catch(() => null);
  if (chatId) {
    // Telegram is best-effort: the notification must land in the inbox whether
    // or not the bot could reach them, so a send failure is recorded, not thrown.
    delivered = await sendTelegramMessage(chatId, `🔗 ${message}`).then(
      () => true,
      () => false,
    );
  }

  await logReminderSent({ userId, projectId, nextStep: message, delivered });
}
