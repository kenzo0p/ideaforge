import { schedulePlan } from "@/lib/plan/schedule";
import type { ProjectPlan, ResearchReport } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Does this brief contradict itself?
//
// A briefing is produced in three separate calls — validate, research, plan —
// and nothing has ever compared them. So a project can say the problem scores
// 3/10 and not be worth building, and then carry a sixteen-week plan for
// building it. The narrative can cite source [7] when only six sources exist.
// The architecture can wire a component to one that was never defined. Each
// artifact is internally plausible, which is exactly why nobody notices.
//
// None of this needs a model to detect. These are facts about the data, and the
// rules below are pure predicates over it: no network, no LLM, no clock, so a
// finding is reproducible and arguable rather than another opinion.
//
// Findings are tiered, and the tiering is the honest part. A dangling citation
// marker is a *contradiction* — the document refers to something that is not
// there, and there is no reading under which that is fine. "Research found
// three gaps and the plan mentions one" is a *note*: it is usually worth
// knowing and it is sometimes simply a focused plan. Presenting the second with
// the confidence of the first would be the overreach this product exists to
// avoid.
// ---------------------------------------------------------------------------

export type FindingSeverity =
  /** The artifacts state incompatible things. There is no benign reading. */
  | "contradiction"
  /** Something referenced does not exist, or something required is missing. */
  | "gap"
  /** Worth a look; a reasonable project might be like this on purpose. */
  | "note";

export type Where = "validation" | "research" | "plan" | "across";

export interface ConsistencyFinding {
  /** Stable rule id, so a finding can be recognised across runs. */
  rule: string;
  severity: FindingSeverity;
  where: Where;
  detail: string;
}

export interface ConsistencyReport {
  findings: ConsistencyFinding[];
  /** Rules that had the data they needed and ran. */
  ran: number;
  /** Rules skipped because an artifact they needed is missing. */
  skipped: number;
  checkedAt: number;
}

export interface Artifacts {
  validationMarkdown: string | null;
  research: ResearchReport | null;
  plan: ProjectPlan | null;
}

/** Everything a rule is allowed to look at, with the nullables resolved. */
interface Context {
  validationMarkdown: string;
  research: ResearchReport;
  plan: ProjectPlan;
  /** Severity out of ten, when the validation stated one. */
  severity: number | null;
  /** Citation ids referenced by `[n]` markers in the narrative. */
  referenced: Set<number>;
}

interface Rule {
  id: string;
  severity: FindingSeverity;
  where: Where;
  /** Artifacts this rule cannot run without. */
  needs: Array<"validation" | "research" | "plan">;
  /** One detail string per finding; empty means the rule passed. */
  run(ctx: Context): string[];
}

/**
 * The severity score the validation gave, out of ten.
 *
 * The validation is prose, so this is a read of someone else's writing rather
 * than a field. It matches the shapes the prompt actually asks for — "Severity
 * — 8/10", "**Severity**: 7 / 10" — and returns null on anything else. A
 * misread score would drive a contradiction that is not there, so nothing is
 * inferred from a bare number.
 */
export function parseSeverity(markdown: string): number | null {
  const m = markdown.match(/severity\b[^\n]{0,40}?(\d{1,2})\s*\/\s*10/i);
  if (!m) return null;
  const value = Number(m[1]);
  return value >= 0 && value <= 10 ? value : null;
}

/** Citation ids the narrative actually refers to. */
function referencedIds(markdown: string): Set<number> {
  const out = new Set<number>();
  for (const m of markdown.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const raw of m[1].split(",")) {
      const n = Number(raw.trim());
      if (Number.isInteger(n)) out.add(n);
    }
  }
  return out;
}

const COMMON = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under",
  "using", "based", "data", "system", "platform", "tool", "user", "users",
  "solution", "service", "support", "management", "based", "real", "time",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !COMMON.has(w)),
  );
}

/** Does `haystack` talk about the same things as `needle`? */
function mentions(needle: string, haystack: string): boolean {
  const want = contentWords(needle);
  if (want.size === 0) return true;
  const have = contentWords(haystack);
  let hits = 0;
  for (const w of want) if (have.has(w)) hits++;
  // A third of the distinctive words is a low bar, deliberately: this feeds a
  // `note`, and a note that fires constantly is one nobody reads.
  return hits / want.size >= 0.34;
}

// ---------------------------------------------------------------------------
// The rules.
//
// Adding one is adding an entry here. That is the whole point of the shape:
// every rule declares what it needs, so a project with no plan skips the
// plan rules instead of each rule re-checking whether a plan exists and one of
// them eventually forgetting.
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  {
    id: "dangling-citation",
    severity: "contradiction",
    where: "research",
    needs: ["research"],
    run: ({ research, referenced }) => {
      const known = new Set(research.citations.map((c) => c.id));
      const missing = [...referenced].filter((id) => !known.has(id)).sort((a, b) => a - b);
      return missing.length
        ? [
            `The briefing cites ${missing.map((id) => `[${id}]`).join(", ")}, but ` +
              `${missing.length === 1 ? "that source is" : "those sources are"} not in its source list.`,
          ]
        : [];
    },
  },
  {
    id: "unused-citation",
    severity: "gap",
    where: "research",
    needs: ["research"],
    run: ({ research, referenced }) => {
      const unused = research.citations.filter((c) => !referenced.has(c.id));
      // All of them unused means the narrative carries no markers at all, which
      // is a different and already-visible problem, not a list of findings.
      if (unused.length === 0 || unused.length === research.citations.length) return [];
      return [
        `${unused.length} of ${research.citations.length} listed sources ` +
          `(${unused.map((c) => `[${c.id}]`).join(", ")}) are never referenced by the briefing — ` +
          `they were found, not used.`,
      ];
    },
  },
  {
    id: "no-citation-markers",
    severity: "contradiction",
    where: "research",
    needs: ["research"],
    run: ({ research, referenced }) =>
      research.citations.length > 0 && referenced.size === 0
        ? [
            `The briefing lists ${research.citations.length} sources but attaches none of them ` +
              `to a claim, so nothing in it is actually grounded.`,
          ]
        : [],
  },
  {
    id: "duplicate-source",
    severity: "gap",
    where: "research",
    needs: ["research"],
    run: ({ research }) => {
      const byUrl = new Map<string, number[]>();
      for (const c of research.citations) {
        if (!c.url) continue;
        const key = c.url.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
        byUrl.set(key, [...(byUrl.get(key) ?? []), c.id]);
      }
      return [...byUrl.values()]
        .filter((ids) => ids.length > 1)
        .map(
          (ids) =>
            `${ids.map((id) => `[${id}]`).join(" and ")} are the same URL listed as separate ` +
            `sources, which makes the evidence look broader than it is.`,
        );
    },
  },
  {
    id: "solution-cites-unknown",
    severity: "contradiction",
    where: "research",
    needs: ["research"],
    run: ({ research }) => {
      const known = new Set(research.citations.map((c) => c.id));
      return research.existingSolutions.flatMap((s) => {
        const bad = (s.citations ?? []).filter((id) => !known.has(id));
        return bad.length
          ? [`"${s.name}" is backed by ${bad.map((id) => `[${id}]`).join(", ")}, which ${bad.length === 1 ? "does" : "do"} not exist.`]
          : [];
      });
    },
  },
  {
    id: "dangling-architecture-link",
    severity: "contradiction",
    where: "plan",
    needs: ["plan"],
    run: ({ plan }) => {
      const names = new Set(plan.architecture.map((c) => c.name.trim().toLowerCase()));
      return plan.architecture.flatMap((c) => {
        const missing = c.connectsTo.filter((n) => !names.has(n.trim().toLowerCase()));
        return missing.length
          ? [`"${c.name}" connects to ${missing.map((n) => `"${n}"`).join(", ")}, which ${missing.length === 1 ? "is not a component" : "are not components"} of this architecture.`]
          : [];
      });
    },
  },
  {
    id: "duplicate-milestone-phase",
    severity: "gap",
    where: "plan",
    needs: ["plan"],
    run: ({ plan }) => {
      const seen = new Map<string, number>();
      const dupes: string[] = [];
      for (const m of plan.milestones) {
        const key = m.phase.trim().toLowerCase();
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        if (count === 2) dupes.push(m.phase);
      }
      return dupes.map((phase) => `Two milestones are both labelled "${phase}".`);
    },
  },
  {
    id: "empty-milestone",
    severity: "gap",
    where: "plan",
    needs: ["plan"],
    run: ({ plan }) =>
      plan.milestones.flatMap((m) =>
        m.tasks.length === 0 || !m.deliverable.trim()
          ? [`"${m.phase}" has ${m.tasks.length === 0 ? "no tasks" : "no deliverable"}, so there is nothing to do or nothing to show for it.`]
          : [],
      ),
  },
  {
    id: "unschedulable-plan",
    severity: "contradiction",
    where: "plan",
    needs: ["plan"],
    run: ({ plan }) => {
      // Reuses the scheduler rather than re-deriving it, so the two surfaces can
      // never disagree about whether a plan is buildable.
      const schedule = schedulePlan(plan.milestones);
      return schedule.problems
        .filter((p) => p.kind === "cycle" || p.kind === "self-dependency")
        .map((p) => p.detail);
    },
  },
  {
    id: "planned-despite-weak-verdict",
    severity: "contradiction",
    where: "across",
    needs: ["validation", "plan"],
    run: ({ severity, plan }) =>
      severity !== null && severity <= 4 && plan.milestones.length > 0
        ? [
            `Validation scored this problem ${severity}/10 — a verdict that it is not worth ` +
              `building — and a ${plan.milestones.length}-milestone plan for building it was ` +
              `generated anyway. One of the two is wrong.`,
          ]
        : [],
  },
  {
    id: "ungrounded-plan",
    severity: "gap",
    where: "across",
    needs: ["research", "plan"],
    run: ({ research, plan }) =>
      research.citations.length === 0 && plan.milestones.length > 0
        ? [`There is a full plan but the research behind it cites no sources at all.`]
        : [],
  },
  {
    id: "unaddressed-gaps",
    severity: "note",
    where: "across",
    needs: ["research", "plan"],
    run: ({ research, plan }) => {
      if (research.gaps.length === 0 || plan.milestones.length === 0) return [];
      const planText = [
        plan.pitch,
        ...plan.techStack.map((t) => `${t.choice} ${t.why}`),
        ...plan.architecture.map((a) => `${a.name} ${a.responsibility}`),
        ...plan.milestones.map((m) => `${m.phase} ${m.goal} ${m.tasks.join(" ")} ${m.deliverable}`),
      ].join(" ");
      const unaddressed = research.gaps.filter((g) => !mentions(`${g.title} ${g.opportunity}`, planText));
      if (unaddressed.length === 0) return [];
      return [
        `Research identified ${research.gaps.length} innovation ` +
          `${research.gaps.length === 1 ? "gap" : "gaps"}, and the plan does not appear to address ` +
          `${unaddressed.map((g) => `"${g.title}"`).join(", ")}. That may be deliberate focus; ` +
          `it is worth being deliberate about.`,
      ];
    },
  },
  {
    id: "demo-artifacts-mixed",
    severity: "gap",
    where: "across",
    needs: ["research", "plan"],
    run: ({ research, plan }) =>
      research.demo !== plan.demo
        ? [
            `The ${research.demo ? "research" : "plan"} came from the offline demo provider and ` +
              `the ${research.demo ? "plan" : "research"} did not, so this brief mixes real output ` +
              `with placeholder output.`,
          ]
        : [],
  },
];

/**
 * Run every rule that has the data it needs.
 *
 * Rules never throw by contract, but one written later might, and a single bad
 * predicate should not cost the user every other finding — so each is isolated.
 */
export function checkConsistency(artifacts: Artifacts): ConsistencyReport {
  const { validationMarkdown, research, plan } = artifacts;
  const available = {
    validation: typeof validationMarkdown === "string" && validationMarkdown.trim().length > 0,
    research: research !== null,
    plan: plan !== null,
  };

  const ctx: Context = {
    validationMarkdown: validationMarkdown ?? "",
    research: research ?? ({ citations: [], existingSolutions: [], gaps: [], queries: [], summaryMarkdown: "", demo: false } as ResearchReport),
    plan: plan ?? ({ title: "", pitch: "", techStack: [], architecture: [], milestones: [], apis: [], repos: [], datasets: [], papers: [], clusters: [], demo: false } as ProjectPlan),
    severity: validationMarkdown ? parseSeverity(validationMarkdown) : null,
    referenced: referencedIds(research?.summaryMarkdown ?? ""),
  };

  const findings: ConsistencyFinding[] = [];
  let ran = 0;
  let skipped = 0;

  for (const rule of RULES) {
    if (!rule.needs.every((n) => available[n])) {
      skipped++;
      continue;
    }
    ran++;
    try {
      for (const detail of rule.run(ctx)) {
        findings.push({ rule: rule.id, severity: rule.severity, where: rule.where, detail });
      }
    } catch (err) {
      console.error(`Consistency rule ${rule.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  const order: FindingSeverity[] = ["contradiction", "gap", "note"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return { findings, ran, skipped, checkedAt: Date.now() };
}

/** How many rules exist, for a UI that wants to say "0 of 13 found a problem". */
export const RULE_COUNT = RULES.length;
