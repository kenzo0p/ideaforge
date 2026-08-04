import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getSearchProvider } from "@/lib/search";
import { hostnameOf, type SearchResult } from "@/lib/search/types";
import { relevantToIdea } from "@/lib/insights/relevance";
import { getProject } from "@/lib/db/projects";
import { getChatIdForUser } from "@/lib/db/telegram";
import { sendTelegramMessage } from "@/lib/agents/telegram";
import { publish } from "@/lib/realtime";
import {
  advanceWatch,
  bumpUnseen,
  dueWatches,
  recordFindings,
  type Finding,
  type FindingKind,
  type Watch,
} from "@/lib/db/watches";

// ---------------------------------------------------------------------------
// Watch runner — the thing that makes IdeaForge recurring rather than one-off.
//
// Each cycle re-runs a project's research queries with a recency window and
// keeps only results never seen for that watch. The deduplication is done by a
// unique index (see db/watches.ts), so this code stays simple and two
// overlapping cycles can't double-report.
//
// Runs from the same scheduler as reminders on a persistent host, and from
// /api/cron/reminders on serverless.
// ---------------------------------------------------------------------------

/** How far back a cycle looks. Slightly wider than the cadence so nothing slips through a gap. */
const LOOKBACK_DAYS: Record<Watch["cadence"], number> = { daily: 3, weekly: 10 };

/** Classify a result so the UI can group findings. */
function classify(r: SearchResult): FindingKind {
  const host = r.source.toLowerCase();
  const text = `${r.title} ${r.url}`.toLowerCase();
  if (host.includes("github.") || host.includes("gitlab.")) return "repo";
  if (host.includes("kaggle") || host.includes("huggingface") || text.includes("dataset")) {
    return "dataset";
  }
  if (
    host.includes("arxiv") ||
    host.includes("semanticscholar") ||
    host.includes("core.ac.uk") ||
    host.includes("pubmed") ||
    host.includes("doi.org") ||
    text.includes("paper")
  ) {
    return "paper";
  }
  return "news";
}

/**
 * Run one watch cycle.
 *
 * Returns the findings that were genuinely new. Never throws: a watch that
 * fails must not stop the ones behind it in the queue.
 */
export async function runWatch(watch: Watch): Promise<Finding[]> {
  const searcher = getSearchProvider();
  const lookback = LOOKBACK_DAYS[watch.cadence];

  const batches = await Promise.all(
    watch.queries.map((q) =>
      searcher
        .search(q, { maxResults: 5, recentDays: lookback })
        .catch(() => [] as SearchResult[]),
    ),
  );

  // The project supplies the vocabulary used to reject off-topic hits. A
  // recency-filtered news search drifts easily, and a monitor that cries wolf
  // gets muted — which is worse than one that occasionally says nothing.
  const project = await getProject(watch.projectId, watch.userId);
  const idea = project?.idea ?? watch.projectTitle;

  const seen = new Set<string>();
  const candidates = relevantToIdea(idea, batches.flat())
    .filter((r) => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .slice(0, 12)
    .map((r) => ({
      watchId: watch.id,
      projectId: watch.projectId,
      userId: watch.userId,
      title: r.title,
      url: r.url,
      source: r.source || hostnameOf(r.url),
      snippet: r.content?.slice(0, 220),
      kind: classify(r),
    }));

  const fresh = await recordFindings(watch.id, candidates);
  await bumpUnseen(watch.id, fresh.length);
  await advanceWatch(watch.id, watch.cadence);

  if (fresh.length > 0) {
    void track(EVENTS.WATCH_FINDINGS, {
      userId: watch.userId,
      props: { count: fresh.length, cadence: watch.cadence },
    });
    // Live badge for anyone with the app open.
    publish(`user:${watch.userId}`, { type: "invite" });
    await notify(watch, fresh).catch(() => {
      /* delivery is best-effort; the findings are already saved */
    });
  }

  return fresh;
}

/** Push a short digest to Telegram when the user has it linked. */
async function notify(watch: Watch, findings: Finding[]): Promise<void> {
  const chatId = await getChatIdForUser(watch.userId);
  if (!chatId) return;

  const lines = findings
    .slice(0, 5)
    .map((f) => `• [${f.title.slice(0, 70)}](${f.url})`)
    .join("\n");
  const more = findings.length > 5 ? `\n\n…and ${findings.length - 5} more.` : "";

  await sendTelegramMessage(
    chatId,
    `🔭 *${findings.length} new in ${watch.projectTitle}*\n\n${lines}${more}`,
    [[{ text: "📊 Open project", data: `use:${watch.projectId}` }]],
  );
}

/**
 * Run every due watch. Returns how many were processed.
 *
 * Sequential on purpose: each cycle is several searches, and running twenty in
 * parallel would spike the search provider's rate limit for no benefit — nobody
 * is waiting on this.
 */
export async function runDueWatches(now = Date.now()): Promise<number> {
  let due: Watch[];
  try {
    due = await dueWatches(now);
  } catch (err) {
    console.error("Watch query failed:", err);
    return 0;
  }

  for (const watch of due) {
    try {
      const fresh = await runWatch(watch);
      if (fresh.length) {
        console.log(`🔭 ${watch.projectTitle}: ${fresh.length} new finding(s).`);
      }
    } catch (err) {
      console.error(`Watch ${watch.id} failed:`, err instanceof Error ? err.message : err);
      // Still advance, or a permanently failing watch blocks the queue forever.
      await advanceWatch(watch.id, watch.cadence).catch(() => {});
    }
  }
  return due.length;
}
