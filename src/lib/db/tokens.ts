import { randomUUID } from "node:crypto";
import { col } from "./index";
import type { TokenUsage } from "@/lib/ai/usage";

// ---------------------------------------------------------------------------
// What each run cost, kept.
//
// One row per model-backed operation, not per model call: a DeepSearch makes
// several calls and a user thinks of it as one action, so the row is the action
// and `calls` records how many requests it took underneath.
//
// Stored rather than derived because the question people ask is historical —
// "how much did this project cost me", "is validation or research the expensive
// one" — and a live provider will not tell you about yesterday.
// ---------------------------------------------------------------------------

/** The model-backed actions a user can take. */
export type Operation =
  | "validate"
  | "research"
  | "plan"
  | "compare"
  | "discover"
  | "review"
  | "prompts"
  | "agent";

export const OPERATION_LABEL: Record<Operation, string> = {
  validate: "Problem validation",
  research: "DeepSearch",
  plan: "Build plan",
  compare: "Idea comparison",
  discover: "Problem discovery",
  review: "Deck review",
  prompts: "Prompt studio",
  agent: "Assistant reply",
};

export interface UsageRecord {
  id: string;
  userId: string;
  /** Null for a run that was never saved to a project. */
  projectId: string | null;
  operation: Operation;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimated: boolean;
  provider: string;
  model: string;
  createdAt: number;
}

interface UsageDoc extends Omit<UsageRecord, "id"> {
  _id: string;
  /** Reaped by a TTL index; see db/index.ts. */
  expiresAt: Date;
}

const usage = () => col<UsageDoc>("tokenUsage");

/** How long a row lives. Long enough for a term's worth of history. */
const RETENTION_DAYS = 180;

/**
 * Record what an operation cost.
 *
 * Never throws. A failure to write a usage row must not fail the run that
 * produced it — the user asked for a validation, not for bookkeeping, and
 * losing the row costs a number on a page rather than their work.
 */
export async function recordUsage(input: {
  userId: string;
  projectId?: string | null;
  operation: Operation;
  usage: TokenUsage;
}): Promise<void> {
  // A run that reported nothing is not a run worth a row. This happens when a
  // provider fails before answering, and a row of zeroes would quietly claim
  // the call succeeded and cost nothing.
  if (input.usage.calls === 0) return;

  try {
    const now = Date.now();
    await (await usage()).insertOne({
      _id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId ?? null,
      operation: input.operation,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      calls: input.usage.calls,
      estimated: input.usage.estimated,
      provider: input.usage.provider,
      model: input.usage.model,
      createdAt: now,
      expiresAt: new Date(now + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    console.error("Could not record token usage:", err instanceof Error ? err.message : err);
  }
}

export interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  runs: number;
  calls: number;
  /** True when any run in the total was an estimate. */
  estimated: boolean;
}

const ZERO: UsageTotal = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  runs: 0,
  calls: 0,
  estimated: false,
};

function sum(rows: Array<Pick<UsageDoc, "inputTokens" | "outputTokens" | "calls" | "estimated">>): UsageTotal {
  const t = { ...ZERO };
  for (const r of rows) {
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.calls += r.calls;
    t.runs += 1;
    t.estimated = t.estimated || r.estimated;
  }
  t.totalTokens = t.inputTokens + t.outputTokens;
  return t;
}

/** Everything one project has cost, and the breakdown by operation. */
export async function projectUsage(projectId: string): Promise<{
  total: UsageTotal;
  byOperation: Array<{ operation: Operation; total: UsageTotal }>;
  recent: UsageRecord[];
}> {
  const docs = await (await usage()).find({ projectId }).sort({ createdAt: -1 }).toArray();

  const groups = new Map<Operation, UsageDoc[]>();
  for (const d of docs) groups.set(d.operation, [...(groups.get(d.operation) ?? []), d]);

  return {
    total: sum(docs),
    byOperation: [...groups]
      .map(([operation, rows]) => ({ operation, total: sum(rows) }))
      .sort((a, b) => b.total.totalTokens - a.total.totalTokens),
    recent: docs.slice(0, 12).map(toRecord),
  };
}

/** Everything one person has spent since `since`, with a per-operation split. */
export async function userUsage(
  userId: string,
  since = 0,
): Promise<{ total: UsageTotal; byOperation: Array<{ operation: Operation; total: UsageTotal }> }> {
  const docs = await (await usage())
    .find({ userId, createdAt: { $gte: since } })
    .toArray();

  const groups = new Map<Operation, UsageDoc[]>();
  for (const d of docs) groups.set(d.operation, [...(groups.get(d.operation) ?? []), d]);

  return {
    total: sum(docs),
    byOperation: [...groups]
      .map(([operation, rows]) => ({ operation, total: sum(rows) }))
      .sort((a, b) => b.total.totalTokens - a.total.totalTokens),
  };
}

/** The most recent run, for showing a figure straight after one finishes. */
export async function latestRun(userId: string): Promise<UsageRecord | null> {
  const d = await (await usage()).find({ userId }).sort({ createdAt: -1 }).limit(1).next();
  return d ? toRecord(d) : null;
}

/**
 * Attach a user's unassigned recent runs to a project.
 *
 * Runs happen before a project exists: someone validates an idea, researches
 * it, and only then saves. Those rows are written with no project, and this
 * claims them when the save happens.
 *
 * It is a heuristic and the window is what bounds it — only rows from the last
 * few minutes, and only rows not already claimed, so an idea validated
 * yesterday and abandoned cannot be charged to a project created today. A run
 * that falls outside the window keeps `projectId: null` and still counts
 * towards the user's own total, which is the safer way to be wrong.
 */
const CLAIM_WINDOW_MS = 45 * 60 * 1000;

export async function attachRecentUsage(userId: string, projectId: string): Promise<number> {
  try {
    const res = await (await usage()).updateMany(
      { userId, projectId: null, createdAt: { $gte: Date.now() - CLAIM_WINDOW_MS } },
      { $set: { projectId } },
    );
    return res.modifiedCount ?? 0;
  } catch (err) {
    console.error("Could not attach usage to project:", err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function purgeProjectUsage(projectId: string): Promise<void> {
  await (await usage()).deleteMany({ projectId });
}

export async function purgeUserUsage(userId: string): Promise<void> {
  await (await usage()).deleteMany({ userId });
}

function toRecord(d: UsageDoc): UsageRecord {
  const { _id, expiresAt, ...rest } = d;
  void expiresAt;
  return { id: _id, ...rest };
}
