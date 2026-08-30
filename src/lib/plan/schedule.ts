import type { Milestone } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Is this plan actually possible?
//
// The same move this product makes on citations, applied to the plan. A model
// asked for a roadmap produces one that *reads* like a schedule: phases with
// week ranges, each depending on the last. Nothing checks it, so nothing
// notices when milestone four is scheduled for week 5 and depends on work that
// does not finish until week 8, or when two milestones depend on each other and
// the plan cannot start at all.
//
// Those are not judgement calls. Given durations and dependencies, whether a
// schedule is self-consistent is arithmetic — the critical path method, which
// has been standard since the 1950s and which no LLM performs when it writes a
// timeline. So the model proposes and this file checks:
//
//   1. cycles          a plan whose milestones depend on each other circularly
//   2. earliest start   the first week each milestone could actually begin
//   3. slack            how far each can slip before the end date moves
//   4. critical path    the milestones where slippage costs a week each time
//   5. stated vs real   what the plan claims against what it requires
//
// The output is a *verified* plan rather than a generated one, and the finding
// people care about is the fifth: "this says twelve weeks and needs sixteen."
// ---------------------------------------------------------------------------

export interface ScheduledMilestone {
  index: number;
  phase: string;
  goal: string;
  /** Weeks of work. */
  duration: number;
  /** Indices this cannot start before. */
  dependsOn: number[];
  /** Week the plan says it starts, 1-based, when the label could be read. */
  statedStart: number | null;
  statedEnd: number | null;
  /** Week it could actually start, given its dependencies. 1-based. */
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** Weeks it can slip before the project's end date moves. */
  slack: number;
  critical: boolean;
}

export type ProblemKind =
  /** Milestones that depend on each other, directly or through a chain. */
  | "cycle"
  /** Scheduled to begin before the work it depends on can finish. */
  | "starts-too-early"
  /** Depends on a milestone that does not exist. */
  | "unknown-dependency"
  /** Depends on itself. */
  | "self-dependency"
  /** The stated end date is earlier than the critical path allows. */
  | "overruns";

export interface ScheduleProblem {
  kind: ProblemKind;
  /** Milestone indices involved. */
  milestones: number[];
  detail: string;
}

export interface Schedule {
  milestones: ScheduledMilestone[];
  /** Indices on the critical path, earliest first. */
  criticalPath: number[];
  /** Weeks the dependency graph requires. */
  computedWeeks: number;
  /** Weeks the plan claims, from its own phase labels. Null when unreadable. */
  statedWeeks: number | null;
  problems: ScheduleProblem[];
  /**
   * True when dependencies were assumed rather than stated.
   *
   * A plan saved before the model was asked for dependencies has none, and a
   * phased roadmap implies a chain. The assumption is reasonable and it is also
   * an assumption, so it is reported rather than hidden: with an inferred chain
   * every milestone is critical, which is a property of the guess and not a
   * finding about the plan.
   */
  inferred: boolean;
}

/**
 * Read a week range out of a phase label.
 *
 * The labels are model-written prose — "Week 1–2 · Foundation", "Weeks 3-4:
 * Build", "Phase 2 (Weeks 6–8)", "Month 2" — so this is deliberately forgiving
 * and returns null rather than guessing when it cannot tell. A wrong start week
 * would produce a fabricated scheduling violation, which is worse than none.
 */
export function parsePhase(label: string): { start: number; end: number } | null {
  const text = label.toLowerCase().replace(/[–—]/g, "-");

  const weeks = text.match(/weeks?\s*(\d+)\s*(?:-|to)\s*(\d+)/);
  if (weeks) return { start: Number(weeks[1]), end: Number(weeks[2]) };

  const oneWeek = text.match(/weeks?\s*(\d+)/);
  if (oneWeek) return { start: Number(oneWeek[1]), end: Number(oneWeek[1]) };

  const months = text.match(/months?\s*(\d+)\s*(?:-|to)\s*(\d+)/);
  if (months) return { start: (Number(months[1]) - 1) * 4 + 1, end: Number(months[2]) * 4 };

  const oneMonth = text.match(/months?\s*(\d+)/);
  if (oneMonth) return { start: (Number(oneMonth[1]) - 1) * 4 + 1, end: Number(oneMonth[1]) * 4 };

  return null;
}

/** Duration in weeks, from the model's own field or from the phase label. */
function durationOf(m: Milestone, phase: { start: number; end: number } | null): number {
  if (typeof m.durationWeeks === "number" && m.durationWeeks > 0) {
    return Math.round(m.durationWeeks);
  }
  if (phase) return Math.max(1, phase.end - phase.start + 1);
  // Nothing stated one. A milestone takes non-zero time, and one week is the
  // smallest claim that stays true.
  return 1;
}

/**
 * Find every cycle in the dependency graph.
 *
 * Depth-first with three colours — unvisited, on the current path, finished.
 * Meeting a node that is on the current path is a back edge, and the slice of
 * the path from that node onwards is the cycle itself, which is what a reader
 * needs in order to fix it.
 */
function findCycles(edges: number[][]): number[][] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Array<number>(edges.length).fill(WHITE);
  const path: number[] = [];
  const cycles: number[][] = [];
  const seen = new Set<string>();

  const walk = (node: number) => {
    colour[node] = GREY;
    path.push(node);
    for (const next of edges[node]) {
      if (colour[next] === GREY) {
        const cycle = path.slice(path.indexOf(next));
        // The same cycle is reachable from each of its members; report it once.
        const key = [...cycle].sort((a, b) => a - b).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (colour[next] === WHITE) {
        walk(next);
      }
    }
    path.pop();
    colour[node] = BLACK;
  };

  for (let i = 0; i < edges.length; i++) if (colour[i] === WHITE) walk(i);
  return cycles;
}

/** Kahn's algorithm. Returns null when the graph is not a DAG. */
function topologicalOrder(edges: number[][]): number[] | null {
  const n = edges.length;
  const indegree = new Array<number>(n).fill(0);
  for (const from of edges) for (const to of from) indegree[to]++;

  const queue = indegree.flatMap((d, i) => (d === 0 ? [i] : []));
  const order: number[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    for (const next of edges[node]) if (--indegree[next] === 0) queue.push(next);
  }
  return order.length === n ? order : null;
}

/**
 * Work out what the plan actually requires.
 *
 * Pure: no database, no model, no clock. The whole point is that this answer is
 * reproducible and arguable — a student should be able to check it by hand, and
 * disagree with it if it is wrong.
 */
export function schedulePlan(milestones: Milestone[]): Schedule {
  const n = milestones.length;
  const empty: Schedule = {
    milestones: [], criticalPath: [], computedWeeks: 0,
    statedWeeks: null, problems: [], inferred: false,
  };
  if (n === 0) return empty;

  const phases = milestones.map((m) => parsePhase(m.phase));
  const durations = milestones.map((m, i) => durationOf(m, phases[i]));
  const problems: ScheduleProblem[] = [];

  // Dependencies as stated, or a chain if the plan predates the question.
  const stated = milestones.some((m) => Array.isArray(m.dependsOn));
  const dependsOn: number[][] = milestones.map((m, i) => {
    if (!stated) return i === 0 ? [] : [i - 1];
    const raw = m.dependsOn ?? [];
    const clean: number[] = [];
    for (const d of raw) {
      if (d === i) {
        problems.push({
          kind: "self-dependency",
          milestones: [i],
          detail: `"${m.phase}" lists itself as its own prerequisite.`,
        });
        continue;
      }
      if (!Number.isInteger(d) || d < 0 || d >= n) {
        problems.push({
          kind: "unknown-dependency",
          milestones: [i],
          detail: `"${m.phase}" depends on milestone ${d}, which is not in this plan.`,
        });
        continue;
      }
      if (!clean.includes(d)) clean.push(d);
    }
    return clean;
  });

  // Forward edges: prerequisite -> dependent.
  const edges: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const d of dependsOn[i]) edges[d].push(i);

  const cycles = findCycles(edges);
  for (const cycle of cycles) {
    problems.push({
      kind: "cycle",
      milestones: cycle,
      // Numbered as well as named: a model that produced a cycle has often
      // also produced two milestones with the same label, and a loop printed
      // as "A → A → A" tells the reader nothing about which A.
      detail: `These milestones depend on each other in a loop, so none of them can start: ${cycle
        .map((i) => `#${i + 1} "${milestones[i].phase}"`)
        .join(" → ")} → #${cycle[0] + 1}.`,
    });
  }

  const order = topologicalOrder(edges);
  const earliestStart = new Array<number>(n).fill(1);
  const earliestFinish = new Array<number>(n).fill(1);

  if (order) {
    for (const i of order) {
      earliestStart[i] = dependsOn[i].reduce((week, d) => Math.max(week, earliestFinish[d] + 1), 1);
      earliestFinish[i] = earliestStart[i] + durations[i] - 1;
    }
  } else {
    // A cyclic graph has no earliest start. Reporting the stated weeks unchanged
    // keeps the rest of the output readable, and the cycle is already flagged as
    // the thing to fix first.
    for (let i = 0; i < n; i++) {
      earliestStart[i] = phases[i]?.start ?? 1;
      earliestFinish[i] = earliestStart[i] + durations[i] - 1;
    }
  }

  const computedWeeks = Math.max(...earliestFinish);

  // Backward pass, for slack.
  const latestFinish = new Array<number>(n).fill(computedWeeks);
  const latestStart = new Array<number>(n).fill(computedWeeks);
  for (const i of [...(order ?? [...Array(n).keys()])].reverse()) {
    latestFinish[i] = edges[i].length
      ? Math.min(...edges[i].map((next) => latestStart[next] - 1))
      : computedWeeks;
    latestStart[i] = latestFinish[i] - durations[i] + 1;
  }

  // With a cycle there is no ordering, so slack and the critical path are not
  // merely wrong but undefined — every number the backward pass produced came
  // from an arbitrary traversal. Reporting a critical path anyway would dress a
  // meaningless answer as a finding; the cycle is the finding.
  const solvable = order !== null;

  const scheduled: ScheduledMilestone[] = milestones.map((m, i) => {
    const slack = solvable ? Math.max(0, latestStart[i] - earliestStart[i]) : 0;
    return {
      index: i,
      phase: m.phase,
      goal: m.goal,
      duration: durations[i],
      dependsOn: dependsOn[i],
      statedStart: phases[i]?.start ?? null,
      statedEnd: phases[i]?.end ?? null,
      earliestStart: earliestStart[i],
      earliestFinish: earliestFinish[i],
      latestStart: solvable ? latestStart[i] : earliestStart[i],
      latestFinish: solvable ? latestFinish[i] : earliestFinish[i],
      slack,
      critical: solvable && slack === 0,
    };
  });

  // A milestone the plan schedules before its prerequisites can finish. Only
  // checked when the label was readable and the graph is acyclic — otherwise
  // the "violation" would be an artefact of an unparsed label or a cycle
  // already reported.
  if (order) {
    for (const m of scheduled) {
      if (m.statedStart === null || m.dependsOn.length === 0) continue;
      if (m.statedStart >= m.earliestStart) continue;
      problems.push({
        kind: "starts-too-early",
        milestones: [m.index, ...m.dependsOn],
        detail:
          `"${m.phase}" is scheduled to begin in week ${m.statedStart}, but the work it ` +
          `depends on cannot finish before week ${m.earliestStart - 1}.`,
      });
    }
  }

  const statedEnds = phases.filter(Boolean).map((p) => p!.end);
  const statedWeeks = statedEnds.length ? Math.max(...statedEnds) : null;

  if (order && statedWeeks !== null && computedWeeks > statedWeeks) {
    const criticalIds = scheduled.filter((m) => m.critical).map((m) => m.index);
    problems.push({
      kind: "overruns",
      milestones: criticalIds,
      detail:
        `The plan is written as ${statedWeeks} weeks, but its own dependencies require ` +
        `${computedWeeks}. The ${criticalIds.length} milestone${criticalIds.length === 1 ? "" : "s"} ` +
        `on the critical path are where that time is spent.`,
    });
  }

  return {
    milestones: scheduled,
    criticalPath: !solvable
      ? []
      : scheduled
          .filter((m) => m.critical)
          .sort((a, b) => a.earliestStart - b.earliestStart)
          .map((m) => m.index),
    computedWeeks,
    statedWeeks,
    problems,
    inferred: !stated,
  };
}
