import { classifyFailure, type ClassifiedFailure } from "./failures";

// ---------------------------------------------------------------------------
// Dependency health, tracked in-process.
//
// Deliberately not in the database. The point of this is to answer "is the
// model answering right now?", and a health check that itself needs a working
// database is the one that goes quiet exactly when you need it. It lives in
// memory, resets on deploy, and that is the correct trade.
//
// One consequence worth stating: with several instances behind a load
// balancer, each has its own view. That's a feature here — an instance whose
// outbound network is broken should report itself unhealthy even while its
// neighbours are fine.
// ---------------------------------------------------------------------------

export type DependencyId = "ai" | "search" | "db";

export interface DependencyHealth {
  id: DependencyId;
  /** healthy → the last call worked. degraded → repeated failures. */
  status: "healthy" | "degraded" | "unknown";
  lastOkAt: number | null;
  lastFailAt: number | null;
  consecutiveFailures: number;
  /** Since when it has been degraded, for "down for 12m" in the admin view. */
  degradedSince: number | null;
  /** Operator-facing. Never serialised to a public response. */
  lastError: { kind: ClassifiedFailure["kind"]; detail: string; at: number } | null;
}

/**
 * How many failures in a row before a dependency is called degraded.
 *
 * One failure is noise — a dropped socket, a user's cancelled request. Three in
 * a row is a pattern. An outage skips the count entirely: "your credit balance
 * is too low" is not going to fix itself on the next attempt, and waiting for
 * two more users to hit it before saying so helps nobody.
 */
const FAILURE_THRESHOLD = 3;

const g = globalThis as unknown as { __ideaforgeHealth?: Map<DependencyId, DependencyHealth> };

function registry(): Map<DependencyId, DependencyHealth> {
  g.__ideaforgeHealth ??= new Map();
  return g.__ideaforgeHealth;
}

function blank(id: DependencyId): DependencyHealth {
  return {
    id,
    status: "unknown",
    lastOkAt: null,
    lastFailAt: null,
    consecutiveFailures: 0,
    degradedSince: null,
    lastError: null,
  };
}

function entry(id: DependencyId): DependencyHealth {
  const map = registry();
  let found = map.get(id);
  if (!found) {
    found = blank(id);
    map.set(id, found);
  }
  return found;
}

/** Record a working call. Clears a degraded state immediately. */
export function recordSuccess(id: DependencyId): void {
  const h = entry(id);
  const wasDegraded = h.status === "degraded";
  h.status = "healthy";
  h.lastOkAt = Date.now();
  h.consecutiveFailures = 0;
  h.degradedSince = null;
  if (wasDegraded) {
    console.log(`✅ ${id} recovered — answering again.`);
  }
}

/**
 * Record a failed call.
 *
 * Returns the classification so the caller can decide what to show the user
 * without classifying it a second time.
 */
export function recordFailure(id: DependencyId, err: unknown): ClassifiedFailure {
  const classified = classifyFailure(err);
  const h = entry(id);
  h.lastFailAt = Date.now();
  h.consecutiveFailures += 1;
  h.lastError = { kind: classified.kind, detail: classified.detail.slice(0, 800), at: Date.now() };

  const shouldDegrade =
    classified.kind === "outage" || h.consecutiveFailures >= FAILURE_THRESHOLD;

  if (shouldDegrade && h.status !== "degraded") {
    h.status = "degraded";
    h.degradedSince = Date.now();
    // Logged once on the transition, not per request. A dependency failing
    // under load would otherwise write thousands of identical lines and bury
    // the one that mattered.
    console.error(
      `🚨 ${id} is degraded (${classified.kind}) after ${h.consecutiveFailures} failure(s): ${classified.detail.slice(0, 300)}`,
    );
  }
  return classified;
}

export function getHealth(id: DependencyId): DependencyHealth {
  return { ...entry(id) };
}

export function allHealth(): DependencyHealth[] {
  return (["ai", "search", "db"] as DependencyId[]).map(getHealth);
}

/** True when a dependency is known-bad right now. */
export function isDegraded(id: DependencyId): boolean {
  return entry(id).status === "degraded";
}

/**
 * The public shape: status only, no error text.
 *
 * `unknown` counts as healthy. A freshly booted instance has called nothing
 * yet, and reporting a cold start as an outage would make an uptime monitor
 * alert on every deploy.
 */
export function publicHealth(): {
  status: "ok" | "degraded";
  checks: Record<DependencyId, "ok" | "degraded">;
} {
  const checks = {} as Record<DependencyId, "ok" | "degraded">;
  let degraded = false;
  for (const h of allHealth()) {
    const ok = h.status !== "degraded";
    checks[h.id] = ok ? "ok" : "degraded";
    if (!ok) degraded = true;
  }
  return { status: degraded ? "degraded" : "ok", checks };
}

/** Test seam — resets the in-process registry. */
export function resetHealth(): void {
  registry().clear();
}
