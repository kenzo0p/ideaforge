#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Output-quality evaluation.
//
//   npm run eval                      # all cases
//   npm run eval -- --case=crowded-space
//   npm run eval -- --base=https://ideaforge-2e1m.onrender.com
//
// Everything else in this repo tests that the code works. This tests whether
// the *answers* are any good — which is the part that actually decays when a
// prompt is edited or a model is swapped, and the part nobody notices until a
// demo goes badly.
//
// Assertions are deliberately about substance, not wording: score thresholds,
// whether a crowded space is called crowded, whether a geospatial idea produces
// geospatial tooling, whether every citation marker resolves to a real source.
//
// Needs a running server and a session cookie:
//   EVAL_COOKIE="ideaforge_session=…" npm run eval
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const BASE = args.base ?? process.env.EVAL_BASE ?? "http://localhost:3000";
const COOKIE = process.env.EVAL_COOKIE ?? "";
const golden = JSON.parse(readFileSync(new URL("./golden-set.json", import.meta.url), "utf8"));
const cases = args.case ? golden.cases.filter((c) => c.id === args.case) : golden.cases;

if (!COOKIE) {
  console.error("EVAL_COOKIE is required (a signed-in ideaforge_session cookie).");
  process.exit(1);
}

const c = { pass: "\x1b[32m", fail: "\x1b[31m", dim: "\x1b[2m", bold: "\x1b[1m", off: "\x1b[0m" };

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

const results = [];
function check(caseId, label, ok, detail = "") {
  results.push({ caseId, label, ok });
  const mark = ok ? `${c.pass}✓${c.off}` : `${c.fail}✗${c.off}`;
  console.log(`  ${mark} ${label}${ok || !detail ? "" : `  ${c.dim}${detail}${c.off}`}`);
}

const has = (text, words) => words.some((w) => text.toLowerCase().includes(w.toLowerCase()));

for (const t of cases) {
  console.log(`\n${c.bold}${t.id}${c.off}  ${c.dim}${t.why}${c.off}`);
  const e = t.expect;

  try {
    // --- Comparison-based expectations (scores) ---------------------------
    if (e.severityAtMost != null || e.severityAtLeast != null || e.differentiationAtMost != null) {
      // Compared against a deliberately strong control, so scoring is relative
      // rather than absolute — the same way a user would use the feature.
      const control = "A tool that detects sepsis onset from vitals hours before clinicians would";
      const cmp = await post("/api/compare", { ideas: [t.idea, control] });
      const row = cmp.ideas.find((x) => x.idea === t.idea);
      if (!row) throw new Error("idea missing from comparison output");

      if (e.severityAtMost != null)
        check(t.id, `severity ≤ ${e.severityAtMost}`, row.scores.severity <= e.severityAtMost, `got ${row.scores.severity}`);
      if (e.severityAtLeast != null)
        check(t.id, `severity ≥ ${e.severityAtLeast}`, row.scores.severity >= e.severityAtLeast, `got ${row.scores.severity}`);
      if (e.differentiationAtMost != null)
        check(t.id, `differentiation ≤ ${e.differentiationAtMost}`, row.scores.differentiation <= e.differentiationAtMost, `got ${row.scores.differentiation}`);
      if (e.feasibilityAtMost != null)
        check(t.id, `feasibility ≤ ${e.feasibilityAtMost}`, row.scores.feasibility <= e.feasibilityAtMost, `got ${row.scores.feasibility}`);
      if (e.verdictMentionsAny)
        check(t.id, "verdict names the crowding", has(`${row.verdict} ${row.risks.join(" ")}`, e.verdictMentionsAny), row.verdict.slice(0, 70));
    } else if (e.feasibilityAtMost != null) {
      const cmp = await post("/api/compare", { ideas: [t.idea, "A to-do list app"] });
      const row = cmp.ideas.find((x) => x.idea === t.idea);
      check(t.id, `feasibility ≤ ${e.feasibilityAtMost}`, row.scores.feasibility <= e.feasibilityAtMost, `got ${row.scores.feasibility}`);
    }

    // --- Research expectations -------------------------------------------
    if (e.minCitations != null || e.minExistingSolutions != null || e.allCitationsResolve || e.everyMarkerHasSource) {
      const r = await post("/api/research", { idea: t.idea });

      if (e.minCitations != null)
        check(t.id, `≥ ${e.minCitations} citations`, (r.citations?.length ?? 0) >= e.minCitations, `got ${r.citations?.length ?? 0}`);
      if (e.minExistingSolutions != null)
        check(t.id, `≥ ${e.minExistingSolutions} existing solutions named`, (r.existingSolutions?.length ?? 0) >= e.minExistingSolutions, `got ${r.existingSolutions?.length ?? 0}`);
      if (e.allCitationsResolve) {
        const bad = (r.citations ?? []).filter((x) => !/^https?:\/\/.+\..+/.test(x.url ?? ""));
        check(t.id, "every citation is a real URL", bad.length === 0, bad.map((b) => b.url).join(", "));
      }
      if (e.everyMarkerHasSource) {
        const ids = new Set((r.citations ?? []).map((x) => x.id));
        const markers = [...(r.summaryMarkdown ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const dangling = markers.filter((m) => !ids.has(m));
        check(t.id, "no [n] marker points at a missing source", dangling.length === 0, `dangling: ${dangling.join(", ")}`);
      }
    }

    // --- Plan expectations -----------------------------------------------
    if (e.planMentionsAny || e.minMilestones != null || e.minTechStack != null) {
      const plan = await post("/api/plan", { idea: t.idea });
      const blob = JSON.stringify(plan).toLowerCase();

      if (e.planMentionsAny)
        check(t.id, "plan is domain-specific, not generic", has(blob, e.planMentionsAny), "no domain tooling found");
      if (e.minMilestones != null)
        check(t.id, `≥ ${e.minMilestones} milestones`, (plan.milestones?.length ?? 0) >= e.minMilestones, `got ${plan.milestones?.length ?? 0}`);
      if (e.minTechStack != null)
        check(t.id, `≥ ${e.minTechStack} stack choices`, (plan.techStack?.length ?? 0) >= e.minTechStack, `got ${plan.techStack?.length ?? 0}`);
    }
  } catch (err) {
    check(t.id, `case ran without error`, false, err.message);
  }
}

const failed = results.filter((r) => !r.ok);
const pct = results.length ? Math.round(((results.length - failed.length) / results.length) * 100) : 0;

console.log(
  `\n${c.bold}${results.length - failed.length}/${results.length} checks passed (${pct}%)${c.off}`,
);
if (failed.length) {
  console.log(`${c.fail}Failing:${c.off}`);
  for (const f of failed) console.log(`  ${f.caseId} — ${f.label}`);
}

// Model output varies run to run, so a single miss is not a regression. The
// gate is the overall rate; below 80% something has genuinely broken.
process.exit(pct >= 80 ? 0 : 1);
