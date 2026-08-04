import { randomUUID } from "node:crypto";
import { col } from "./index";
import { ACTIVATION_FUNNEL, REVENUE_FUNNEL, type EventName } from "@/lib/analytics/events";

// ---------------------------------------------------------------------------
// Product analytics.
//
// Self-hosted rather than PostHog or Mixpanel: no new vendor, no per-event
// pricing, no user behaviour leaving the deployment, and it works with the
// database that is already there.
//
// Two rules the rest of the app depends on:
//   1. Tracking never blocks or breaks a request. A failed write is dropped,
//      because losing an event is always better than failing the action that
//      produced it.
//   2. No PII beyond the user id. Never an idea, an email, or a project title —
//      an analytics table is not a place to accumulate content.
// ---------------------------------------------------------------------------

/** Raw events expire; the aggregates computed from them are what matter long-term. */
const RETENTION_DAYS = 120;

interface EventDoc {
  _id: string;
  name: EventName;
  userId?: string;
  /** Small, non-identifying dimensions: plan, feature, surface. */
  props?: Record<string, string | number | boolean>;
  createdAt: number;
  expiresAt: Date;
  /** Midnight-aligned, so day-level grouping is an index hit not a computation. */
  day: string;
}

const events = () => col<EventDoc>("analyticsEvents");

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * Record an event. Fire-and-forget by design — callers must not await this in
 * a way that can fail their own work.
 */
export async function track(
  name: EventName,
  opts: { userId?: string; props?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  const now = Date.now();
  try {
    await (await events()).insertOne({
      _id: randomUUID(),
      name,
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.props ? { props: opts.props } : {}),
      createdAt: now,
      day: dayKey(now),
      expiresAt: new Date(now + RETENTION_DAYS * 86_400_000),
    });
  } catch {
    // Deliberately silent. Analytics must never be the reason a user's action
    // fails, and a logged error per dropped event would be its own noise.
  }
}

// --- Reporting -------------------------------------------------------------

export interface FunnelStep {
  event: EventName;
  label: string;
  /** Distinct users who reached this step. */
  users: number;
  /** Share of the step above — where the drop-off actually is. */
  conversionFromPrevious: number | null;
  /** Share of the first step. */
  conversionFromStart: number;
}

/**
 * Distinct users per funnel step within a window.
 *
 * Counts *users*, not events: someone who validates ten ideas is one activated
 * user, and counting events would make the funnel look healthier than it is.
 */
async function funnelFor(
  steps: { event: EventName; label: string }[],
  sinceDays: number,
): Promise<FunnelStep[]> {
  const since = Date.now() - sinceDays * 86_400_000;
  const c = await events();

  const counts = await Promise.all(
    steps.map(async (s) => {
      const distinct = await c.distinct("userId", {
        name: s.event,
        createdAt: { $gte: since },
      });
      return distinct.filter(Boolean).length;
    }),
  );

  const first = counts[0] || 0;
  return steps.map((s, i) => ({
    ...s,
    users: counts[i],
    conversionFromPrevious:
      i === 0 ? null : counts[i - 1] > 0 ? counts[i] / counts[i - 1] : 0,
    conversionFromStart: first > 0 ? counts[i] / first : 0,
  }));
}

export const activationFunnel = (sinceDays = 30) => funnelFor(ACTIVATION_FUNNEL, sinceDays);
export const revenueFunnel = (sinceDays = 30) => funnelFor(REVENUE_FUNNEL, sinceDays);

/** Which limits people actually run into — tells you what to price and what to raise. */
export async function limitsHit(sinceDays = 30): Promise<{ limit: string; count: number }[]> {
  const since = Date.now() - sinceDays * 86_400_000;
  const rows = await (await events())
    .aggregate<{ _id: string; count: number }>([
      { $match: { name: "limit_hit", createdAt: { $gte: since } } },
      { $group: { _id: "$props.limit", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ])
    .toArray();
  return rows.map((r) => ({ limit: r._id ?? "unknown", count: r.count }));
}

/** Daily active users over the window, for the trend line. */
export async function dailyActiveUsers(sinceDays = 14): Promise<{ day: string; users: number }[]> {
  const since = Date.now() - sinceDays * 86_400_000;
  const rows = await (await events())
    .aggregate<{ _id: string; users: string[] }>([
      { $match: { createdAt: { $gte: since }, userId: { $exists: true } } },
      { $group: { _id: "$day", users: { $addToSet: "$userId" } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({ day: r._id, users: r.users.length }));
}

/** Totals per event, so nothing instrumented goes unnoticed. */
export async function eventTotals(sinceDays = 30): Promise<{ name: string; count: number }[]> {
  const since = Date.now() - sinceDays * 86_400_000;
  const rows = await (await events())
    .aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  return rows.map((r) => ({ name: r._id, count: r.count }));
}

/**
 * Share of signups that reached a given step, by signup week.
 *
 * The single most useful retention number: is the product getting better at
 * activating people, or does it only look that way because traffic grew?
 */
export async function weeklyActivation(
  step: EventName,
  weeks = 6,
): Promise<{ week: string; signups: number; activated: number }[]> {
  const since = Date.now() - weeks * 7 * 86_400_000;
  const c = await events();

  const signups = await c
    .find({ name: "signed_up", createdAt: { $gte: since } }, { projection: { userId: 1, createdAt: 1 } })
    .toArray();

  const activatedIds = new Set(
    (await c.distinct("userId", { name: step, createdAt: { $gte: since } })).filter(Boolean),
  );

  const buckets = new Map<string, { signups: number; activated: number }>();
  for (const s of signups) {
    if (!s.userId) continue;
    // Monday-anchored week key.
    const d = new Date(s.createdAt);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const week = d.toISOString().slice(0, 10);
    const b = buckets.get(week) ?? { signups: 0, activated: 0 };
    b.signups++;
    if (activatedIds.has(s.userId)) b.activated++;
    buckets.set(week, b);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, ...v }));
}
