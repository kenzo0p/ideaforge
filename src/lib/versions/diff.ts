import type { ProjectPlan, ResearchReport } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Comparing two versions of a project.
//
// "Something changed" is not useful on its own. The question someone actually
// has when they open history is "is the new verdict better than the old one?",
// and answering it means showing which lines moved, which milestones appeared,
// and whether the research got thinner.
//
// Pure functions, no imports beyond types, so the comparison logic is testable
// without a database or a model.
// ---------------------------------------------------------------------------

export interface LineDiff {
  added: string[];
  removed: string[];
  /** Unchanged line count, for "12 lines changed of 140". */
  unchanged: number;
}

/**
 * Line-level diff via longest common subsequence.
 *
 * A set difference would be simpler but reports every reordered line as both
 * added and removed, which makes a lightly-edited paragraph look rewritten.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split("\n").map((l) => l.trimEnd());
  const b = after.split("\n").map((l) => l.trimEnd());

  // Guard against pathological inputs: LCS is O(n·m), and two 5k-line
  // documents would be 25 million cells. Beyond the cap, fall back to a
  // presence comparison, which is less precise but bounded.
  const CAP = 1500;
  if (a.length > CAP || b.length > CAP) {
    const setA = new Set(a);
    const setB = new Set(b);
    return {
      added: b.filter((l) => l && !setA.has(l)),
      removed: a.filter((l) => l && !setB.has(l)),
      unchanged: a.filter((l) => setB.has(l)).length,
    };
  }

  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      unchanged++;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      if (a[i]) removed.push(a[i]);
      i++;
    } else {
      if (b[j]) added.push(b[j]);
      j++;
    }
  }
  for (; i < a.length; i++) if (a[i]) removed.push(a[i]);
  for (; j < b.length; j++) if (b[j]) added.push(b[j]);

  return { added, removed, unchanged };
}

export interface SetDiff {
  added: string[];
  removed: string[];
}

/** Names present in one list but not the other. Case- and space-insensitive. */
function diffNames(before: string[], after: string[]): SetDiff {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const a = new Map(before.map((x) => [norm(x), x]));
  const b = new Map(after.map((x) => [norm(x), x]));
  return {
    added: [...b].filter(([k]) => !a.has(k)).map(([, v]) => v),
    removed: [...a].filter(([k]) => !b.has(k)).map(([, v]) => v),
  };
}

export interface PlanDiff {
  milestones: SetDiff;
  techStack: SetDiff;
  apis: SetDiff;
  /** Positive when the newer plan has more. */
  milestoneDelta: number;
}

export function diffPlans(before: ProjectPlan | null, after: ProjectPlan | null): PlanDiff | null {
  if (!before && !after) return null;
  const b = before ?? ({} as Partial<ProjectPlan>);
  const a = after ?? ({} as Partial<ProjectPlan>);

  const bm = (b.milestones ?? []).map((m) => m.goal || m.phase);
  const am = (a.milestones ?? []).map((m) => m.goal || m.phase);

  return {
    milestones: diffNames(bm, am),
    // Qualified by category: swapping Postgres for Mongo on the data layer is a
    // real change, and comparing bare choices would miss it when some other
    // layer happens to name the same tool.
    techStack: diffNames(
      (b.techStack ?? []).map((t) => `${t.category}: ${t.choice}`),
      (a.techStack ?? []).map((t) => `${t.category}: ${t.choice}`),
    ),
    apis: diffNames((b.apis ?? []).map((x) => x.name), (a.apis ?? []).map((x) => x.name)),
    milestoneDelta: am.length - bm.length,
  };
}

export interface ResearchDiff {
  citationDelta: number;
  solutionDelta: number;
  gapDelta: number;
  /** Domains cited in the newer version that the older one didn't have. */
  newSources: string[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function diffResearch(
  before: ResearchReport | null,
  after: ResearchReport | null,
): ResearchDiff | null {
  if (!before && !after) return null;
  const b = before ?? ({} as Partial<ResearchReport>);
  const a = after ?? ({} as Partial<ResearchReport>);

  const bHosts = new Set((b.citations ?? []).map((x) => hostOf(x.url)).filter(Boolean));
  const aHosts = [...new Set((a.citations ?? []).map((x) => hostOf(x.url)).filter(Boolean))];

  return {
    citationDelta: (a.citations?.length ?? 0) - (b.citations?.length ?? 0),
    solutionDelta: (a.existingSolutions?.length ?? 0) - (b.existingSolutions?.length ?? 0),
    gapDelta: (a.gaps?.length ?? 0) - (b.gaps?.length ?? 0),
    newSources: aHosts.filter((h) => !bHosts.has(h)),
  };
}
