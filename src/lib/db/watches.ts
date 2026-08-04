import { randomUUID } from "node:crypto";
import { col } from "./index";

// ---------------------------------------------------------------------------
// Watches — standing monitors on a project's problem space.
//
// Research is a snapshot; a watch turns it into a subscription. Every cycle the
// project's queries are re-run with a recency window, and anything not seen
// before becomes a finding.
//
// The "what's new?" diff is done by the database, not in application code: a
// unique index on (watchId, url) means re-inserting a known result simply fails,
// and the count of successful inserts *is* the new-findings count. Doing it in
// memory would need the full history loaded on every cycle, and would race with
// two cycles running at once.
// ---------------------------------------------------------------------------

export type WatchCadence = "daily" | "weekly";

export const CADENCE_MS: Record<WatchCadence, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export interface Watch {
  id: string;
  projectId: string;
  projectTitle: string;
  userId: string;
  cadence: WatchCadence;
  /** Queries re-run each cycle — snapshotted so editing research can't silently change a watch. */
  queries: string[];
  active: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  /** Findings since the user last looked, for the unread badge. */
  unseenCount: number;
  createdAt: number;
}

interface WatchDoc extends Omit<Watch, "id"> {
  _id: string;
}

export type FindingKind = "paper" | "repo" | "dataset" | "news" | "other";

export interface Finding {
  id: string;
  watchId: string;
  projectId: string;
  userId: string;
  title: string;
  url: string;
  source: string;
  snippet?: string;
  kind: FindingKind;
  foundAt: number;
  seen: boolean;
}

interface FindingDoc extends Omit<Finding, "id"> {
  _id: string;
}

const watches = () => col<WatchDoc>("watches");
const findings = () => col<FindingDoc>("watchFindings");

const toWatch = (d: WatchDoc): Watch => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};

// --- Watches ---------------------------------------------------------------

export async function createWatch(input: {
  projectId: string;
  projectTitle: string;
  userId: string;
  cadence: WatchCadence;
  queries: string[];
}): Promise<Watch> {
  const now = Date.now();
  const doc: WatchDoc = {
    // One watch per project: the id is derived, so enabling twice is idempotent
    // rather than creating a duplicate that double-notifies.
    _id: `${input.projectId}:watch`,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    userId: input.userId,
    cadence: input.cadence,
    queries: input.queries.slice(0, 4),
    active: true,
    // First cycle runs on the next tick so the user sees it working immediately
    // rather than wondering whether the toggle did anything.
    nextRunAt: now,
    unseenCount: 0,
    createdAt: now,
  };
  await (await watches()).replaceOne({ _id: doc._id }, doc, { upsert: true });
  return toWatch(doc);
}

export async function getWatch(projectId: string, userId: string): Promise<Watch | null> {
  const d = await (await watches()).findOne({ _id: `${projectId}:watch`, userId });
  return d ? toWatch(d) : null;
}

export async function listWatches(userId: string): Promise<Watch[]> {
  const docs = await (await watches()).find({ userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(toWatch);
}

export async function countActiveWatches(userId: string): Promise<number> {
  return (await watches()).countDocuments({ userId, active: true });
}

export async function stopWatch(projectId: string, userId: string): Promise<void> {
  await (await watches()).deleteOne({ _id: `${projectId}:watch`, userId });
  await (await findings()).deleteMany({ watchId: `${projectId}:watch` });
}

export async function setWatchCadence(
  projectId: string,
  userId: string,
  cadence: WatchCadence,
): Promise<void> {
  await (await watches()).updateOne(
    { _id: `${projectId}:watch`, userId },
    { $set: { cadence, nextRunAt: Date.now() + CADENCE_MS[cadence] } },
  );
}

/** Watches due to run. Ordered oldest-first so nothing starves. */
export async function dueWatches(now: number, limit = 25): Promise<Watch[]> {
  const docs = await (await watches())
    .find({ active: true, nextRunAt: { $lte: now } })
    .sort({ nextRunAt: 1 })
    .limit(limit)
    .toArray();
  return docs.map(toWatch);
}

/** Reschedule after a cycle, whether or not it found anything. */
export async function advanceWatch(watchId: string, cadence: WatchCadence): Promise<void> {
  const now = Date.now();
  await (await watches()).updateOne(
    { _id: watchId },
    { $set: { lastRunAt: now, nextRunAt: now + CADENCE_MS[cadence] } },
  );
}

// --- Findings --------------------------------------------------------------

/**
 * Insert findings, keeping only the ones never seen before.
 *
 * `ordered: false` lets the batch continue past duplicate-key errors, so one
 * already-known URL doesn't discard the genuinely new ones alongside it.
 * Returns what was actually new.
 */
export async function recordFindings(
  watchId: string,
  candidates: Omit<Finding, "id" | "seen" | "foundAt">[],
): Promise<Finding[]> {
  if (candidates.length === 0) return [];
  const now = Date.now();
  const docs: FindingDoc[] = candidates.map((c) => ({
    _id: randomUUID(),
    ...c,
    foundAt: now,
    seen: false,
  }));

  try {
    await (await findings()).insertMany(docs, { ordered: false });
    return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  } catch (err) {
    // Duplicate keys are the expected path: they are the results we already
    // know about. The driver reports which ones failed, so the rest are new.
    const e = err as { writeErrors?: { err?: { index?: number } }[]; result?: unknown };
    const failed = new Set((e.writeErrors ?? []).map((w) => w.err?.index));
    const inserted = docs.filter((_, i) => !failed.has(i));
    if (inserted.length || failed.size) {
      return inserted.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    }
    throw err;
  }
}

export async function bumpUnseen(watchId: string, by: number): Promise<void> {
  if (by <= 0) return;
  await (await watches()).updateOne({ _id: watchId }, { $inc: { unseenCount: by } });
}

export async function listFindings(
  projectId: string,
  userId: string,
  limit = 30,
): Promise<Finding[]> {
  const docs = await (await findings())
    .find({ projectId, userId })
    .sort({ foundAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}

/** Everything new across a user's watches — powers the notifications inbox. */
export async function listUnseenFindings(userId: string, limit = 50): Promise<Finding[]> {
  const docs = await (await findings())
    .find({ userId, seen: false })
    .sort({ foundAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}

export async function markFindingsSeen(projectId: string, userId: string): Promise<void> {
  await (await findings()).updateMany({ projectId, userId, seen: false }, { $set: { seen: true } });
  await (await watches()).updateOne({ _id: `${projectId}:watch`, userId }, { $set: { unseenCount: 0 } });
}

/** Called when a project is deleted. */
export async function purgeWatches(projectId: string): Promise<void> {
  await Promise.all([
    (await watches()).deleteMany({ projectId }),
    (await findings()).deleteMany({ projectId }),
  ]);
}
