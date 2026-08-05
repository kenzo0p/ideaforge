#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Output-quality evaluation.
//
//   npm run eval                              # every case
//   npm run eval -- --tag=honesty,grounding   # one slice
//   npm run eval -- --case=crowded-space
//   npm run eval -- --repeat=3                # majority vote, for flaky checks
//   npm run eval -- --update-baseline         # record this run as the baseline
//   npm run eval -- --json=report.json        # machine-readable artifact
//   npm run eval -- --base=https://ideaforge-2e1m.onrender.com
//
// Everything else in this repo tests that the code works. This tests whether
// the *answers* are any good — the part that decays when a prompt is edited or
// a model is swapped, and the part nobody notices until a demo goes badly.
//
// Assertions are about substance, not wording: score thresholds, whether a
// crowded space is called crowded, whether a geospatial idea produces
// geospatial tooling, whether every citation marker resolves to a real source.
//
// Two properties make it usable as a gate rather than a curiosity:
//
//   • Variance is handled explicitly. Model output differs run to run, so
//     --repeat scores a check by majority and reports anything that disagreed
//     with itself as FLAKY rather than counting it as a pass or a fail.
//   • Regressions are measured against a stored baseline, not an absolute bar.
//     "83% passed" says nothing. "Two checks that passed yesterday fail today"
//     is the sentence that should stop a deploy.
//
// Needs a running server and a session cookie:
//   EVAL_COOKIE="ideaforge_session=…" npm run eval
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const BASE = args.base ?? process.env.EVAL_BASE ?? "http://localhost:3000";
const COOKIE = process.env.EVAL_COOKIE ?? "";
const REPEAT = Math.max(1, Number(args.repeat ?? 1));
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 3));
const BASELINE_PATH = new URL("./baseline.json", import.meta.url);

const golden = JSON.parse(readFileSync(new URL("./golden-set.json", import.meta.url), "utf8"));

let cases = golden.cases;
if (args.case) cases = cases.filter((c) => c.id === args.case);
if (args.tag) {
  const want = args.tag.split(",").map((t) => t.trim());
  cases = cases.filter((c) => (c.tags ?? []).some((t) => want.includes(t)));
}

if (!COOKIE) {
  console.error("EVAL_COOKIE is required (a signed-in ideaforge_session cookie).");
  process.exit(1);
}
if (cases.length === 0) {
  console.error("No cases matched. Check --case / --tag.");
  process.exit(1);
}

const c = {
  pass: "\x1b[32m",
  fail: "\x1b[31m",
  warn: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  off: "\x1b[0m",
};

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify(body),
  });
  // Truncating the body here once hid "credit balance is too low" behind a
  // 120-character cut-off, which is exactly the sentence the outage detector
  // needs. Keep enough of it to be diagnosable.
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

/** /api/analyze streams plain text rather than returning JSON. */
async function stream(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  return res.text();
}

const has = (text, words) => words.some((w) => String(text).toLowerCase().includes(w.toLowerCase()));

/**
 * Is this failure about the provider rather than the answer?
 *
 * Learned the hard way: an API key running out of credit mid-run turned every
 * remaining case into a "failure", produced a 59% score, and reported a locale
 * bug that did not exist. A harness that cannot tell "the answer was wrong"
 * from "nobody answered" is worse than no harness, because it manufactures
 * false findings that cost real time to chase.
 */
const OUTAGE = /credit balance|insufficient_quota|rate.?limit|invalid.?api.?key|authentication|unauthorized|402|429/i;
function outageReason(message) {
  return OUTAGE.test(message) ? message.replace(/\s+/g, " ").slice(0, 200) : null;
}

/** Set once any worker sees a provider outage; every other worker then stops. */
let halted = null;
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

// A control idea for relative scoring. Absolute thresholds drift as a model is
// swapped; scoring one idea against a fixed strong one is closer to how the
// feature is actually used and holds its meaning across models.
const STRONG_CONTROL = "A system that flags sepsis onset from ICU vitals hours before clinicians would";

/**
 * Run one case once and return its checks.
 *
 * Only the endpoints a case's expectations actually need are called — a case
 * asking about citations must not spend a plan generation to find that out.
 */
async function runCase(t) {
  const out = [];
  const add = (label, ok, detail = "") => out.push({ label, ok, detail: ok ? "" : String(detail) });
  const e = t.expect ?? {};
  const locale = t.locale;

  try {
    // --- Comparison -------------------------------------------------------
    const wantsCompare =
      e.severityAtMost != null ||
      e.severityAtLeast != null ||
      e.differentiationAtMost != null ||
      e.feasibilityAtMost != null ||
      e.reachAtLeast != null ||
      e.verdictMentionsAny ||
      e.riskMentionsAny ||
      e.outranks ||
      e.outreaches ||
      e.ranksAllDistinct ||
      e.hasRationale ||
      e.mustNotEqual ||
      e.mustNotMentionAny;

    if (wantsCompare) {
      const ideas = t.ideas ?? [t.idea, e.outranks ?? e.outreaches ?? STRONG_CONTROL];
      const cmp = await post("/api/compare", { ideas, locale });
      const subject = t.ideas ? cmp.ideas[0] : cmp.ideas.find((x) => x.idea === t.idea);
      if (!subject && !t.ideas) throw new Error("idea missing from comparison output");

      const row = t.ideas ? cmp.ideas.find((x) => x.idea === t.ideas[0]) : subject;
      const blob = `${row?.verdict ?? ""} ${(row?.risks ?? []).join(" ")} ${(row?.strengths ?? []).join(" ")}`;

      if (e.severityAtMost != null)
        add(`severity ≤ ${e.severityAtMost}`, row.scores.severity <= e.severityAtMost, `got ${row.scores.severity}`);
      if (e.severityAtLeast != null)
        add(`severity ≥ ${e.severityAtLeast}`, row.scores.severity >= e.severityAtLeast, `got ${row.scores.severity}`);
      if (e.differentiationAtMost != null)
        add(`differentiation ≤ ${e.differentiationAtMost}`, row.scores.differentiation <= e.differentiationAtMost, `got ${row.scores.differentiation}`);
      if (e.feasibilityAtMost != null)
        add(`feasibility ≤ ${e.feasibilityAtMost}`, row.scores.feasibility <= e.feasibilityAtMost, `got ${row.scores.feasibility}`);
      if (e.reachAtLeast != null)
        add(`reach ≥ ${e.reachAtLeast}`, row.scores.reach >= e.reachAtLeast, `got ${row.scores.reach}`);
      if (e.verdictMentionsAny)
        add("verdict names the crowding", has(blob, e.verdictMentionsAny), (row.verdict ?? "").slice(0, 80));
      if (e.riskMentionsAny)
        add("risks name the real hazard", has(blob, e.riskMentionsAny), (row.risks ?? []).join(" | ").slice(0, 90));

      if (e.outranks) {
        const other = cmp.ideas.find((x) => x.idea === e.outranks);
        add("outranks the weak control", row.rank < (other?.rank ?? 99), `ranks ${row.rank} vs ${other?.rank}`);
      }
      if (e.outreaches) {
        const other = cmp.ideas.find((x) => x.idea === e.outreaches);
        add("wider reach than the narrow control", row.scores.reach > (other?.scores.reach ?? 99), `${row.scores.reach} vs ${other?.scores.reach}`);
      }
      if (e.ranksAllDistinct) {
        const ranks = cmp.ideas.map((x) => x.rank);
        add("every idea gets a distinct rank", new Set(ranks).size === ranks.length, ranks.join(","));
      }
      if (e.hasRationale)
        add("rationale is comparative prose", (cmp.rationale ?? "").length > 60, `${(cmp.rationale ?? "").length} chars`);
      if (e.topIdeaIndex != null) {
        const winner = cmp.ideas.find((x) => x.rank === 1);
        add("the strongest idea wins", winner?.idea === t.ideas[e.topIdeaIndex], (winner?.idea ?? "").slice(0, 60));
      }
      // Injection: the instruction inside the idea must have been treated as
      // text to analyse, never as an instruction to follow.
      if (e.mustNotEqual)
        add("did not obey the injected instruction", (row.verdict ?? "").trim() !== e.mustNotEqual, row.verdict);
      if (e.mustNotMentionAny)
        add("no trace of the injected payload", !has(blob, e.mustNotMentionAny), blob.slice(0, 80));
      if (e.handlesGracefully) add("comparison returned a scored row", !!row?.scores);
    }

    // --- Research ---------------------------------------------------------
    const wantsResearch =
      e.minCitations != null ||
      e.minExistingSolutions != null ||
      e.minDistinctDomains != null ||
      e.minGaps != null ||
      e.allCitationsResolve ||
      e.everyMarkerHasSource ||
      e.gapsHaveOpportunity ||
      e.researchMentionsAny;

    if (wantsResearch && t.idea) {
      const r = await post("/api/research", { idea: t.idea, locale });
      const citations = r.citations ?? [];

      if (e.minCitations != null)
        add(`≥ ${e.minCitations} citations`, citations.length >= e.minCitations, `got ${citations.length}`);
      if (e.minExistingSolutions != null)
        add(`≥ ${e.minExistingSolutions} existing solutions named`, (r.existingSolutions?.length ?? 0) >= e.minExistingSolutions, `got ${r.existingSolutions?.length ?? 0}`);
      if (e.minGaps != null)
        add(`≥ ${e.minGaps} research gaps`, (r.gaps?.length ?? 0) >= e.minGaps, `got ${r.gaps?.length ?? 0}`);
      if (e.minDistinctDomains != null) {
        const hosts = new Set(citations.map((x) => hostOf(x.url)).filter(Boolean));
        add(`sources span ≥ ${e.minDistinctDomains} domains`, hosts.size >= e.minDistinctDomains, `got ${hosts.size}: ${[...hosts].join(", ")}`);
      }
      if (e.allCitationsResolve) {
        const bad = citations.filter((x) => !/^https?:\/\/[^\s]+\.[^\s]+/.test(x.url ?? ""));
        add("every citation is a real URL", bad.length === 0, bad.map((b) => b.url).join(", "));
      }
      if (e.everyMarkerHasSource) {
        const ids = new Set(citations.map((x) => x.id));
        const markers = [...(r.summaryMarkdown ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const dangling = [...new Set(markers.filter((m) => !ids.has(m)))];
        add("no [n] marker points at a missing source", dangling.length === 0, `dangling: ${dangling.join(", ")}`);
      }
      if (e.gapsHaveOpportunity) {
        const thin = (r.gaps ?? []).filter((g) => (g.opportunity ?? "").length < 25);
        add("every gap states an opportunity", thin.length === 0, `${thin.length} gap(s) with no opportunity`);
      }
      if (e.researchMentionsAny) {
        const blob = `${r.summaryMarkdown ?? ""} ${JSON.stringify(r.existingSolutions ?? [])}`;
        add("names real incumbents", has(blob, e.researchMentionsAny), "none of the expected names appear");
      }
    }

    // --- Plan -------------------------------------------------------------
    const wantsPlan =
      e.planMentionsAny ||
      e.minMilestones != null ||
      e.maxMilestones != null ||
      e.minTechStack != null ||
      e.minArchitecture != null ||
      e.minApis != null ||
      e.milestonesHaveTasks ||
      e.milestonesHaveTimeframe ||
      e.milestonesHaveDeliverable;

    if (wantsPlan && t.idea) {
      const plan = await post("/api/plan", { idea: t.idea, locale });
      const blob = JSON.stringify(plan).toLowerCase();
      const milestones = plan.milestones ?? [];

      if (e.planMentionsAny)
        add("plan is domain-specific, not generic", has(blob, e.planMentionsAny), "no domain tooling found");
      if (e.minMilestones != null)
        add(`≥ ${e.minMilestones} milestones`, milestones.length >= e.minMilestones, `got ${milestones.length}`);
      if (e.maxMilestones != null)
        add(`≤ ${e.maxMilestones} milestones (scoped, not sprawling)`, milestones.length <= e.maxMilestones, `got ${milestones.length}`);
      if (e.minTechStack != null)
        add(`≥ ${e.minTechStack} stack choices`, (plan.techStack?.length ?? 0) >= e.minTechStack, `got ${plan.techStack?.length ?? 0}`);
      if (e.minArchitecture != null)
        add(`≥ ${e.minArchitecture} architecture components`, (plan.architecture?.length ?? 0) >= e.minArchitecture, `got ${plan.architecture?.length ?? 0}`);
      if (e.minApis != null)
        add(`≥ ${e.minApis} external APIs named`, (plan.apis?.length ?? 0) >= e.minApis, `got ${plan.apis?.length ?? 0}`);
      if (e.milestonesHaveTasks) {
        const empty = milestones.filter((m) => !(m.tasks?.length > 0));
        add("every milestone has tasks", empty.length === 0, `${empty.length} empty`);
      }
      if (e.milestonesHaveTimeframe) {
        // The timeframe lives inside `phase` ("Week 1–2 · Foundation"), so this
        // asserts the convention the UI relies on rather than a field that
        // doesn't exist.
        const vague = milestones.filter((m) => !/week|day|month|sprint|phase\s*\d|\d/i.test(m.phase ?? ""));
        add("every milestone is time-boxed", vague.length === 0, `${vague.length} with no timeframe`);
      }
      if (e.milestonesHaveDeliverable) {
        const empty = milestones.filter((m) => (m.deliverable ?? "").length < 8);
        add("every milestone names a deliverable", empty.length === 0, `${empty.length} without one`);
      }
    }

    // --- Discovery --------------------------------------------------------
    if (t.domain) {
      const d = await post("/api/discover", { domain: t.domain, locale });
      const problems = d.problems ?? [];

      if (e.minProblems != null)
        add(`≥ ${e.minProblems} problems surfaced`, problems.length >= e.minProblems, `got ${problems.length}`);
      if (e.minSources != null)
        add(`≥ ${e.minSources} sources`, (d.sources?.length ?? 0) >= e.minSources, `got ${d.sources?.length ?? 0}`);
      if (e.problemsHaveStarterIdea) {
        const thin = problems.filter((p) => (p.starterIdea ?? "").length < 15);
        add("every problem comes with a starter idea", thin.length === 0, `${thin.length} without one`);
      }
      if (e.allCitationsResolve) {
        const bad = (d.sources ?? []).filter((x) => !/^https?:\/\/[^\s]+\.[^\s]+/.test(x.url ?? ""));
        add("every source is a real URL", bad.length === 0, bad.map((b) => b.url).join(", "));
      }
      if (e.discoveryMentionsAny)
        add("problems are of this domain", has(JSON.stringify(problems), e.discoveryMentionsAny), "nothing domain-specific found");
    }

    // --- Validation / locale ---------------------------------------------
    if (e.respondsInScript || e.respondsInLanguage) {
      const text = await stream("/api/analyze", { idea: t.idea, locale });

      if (e.respondsInScript === "devanagari") {
        const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
        add("answered in Devanagari", devanagari > 80, `${devanagari} Devanagari characters`);
      }
      if (e.respondsInLanguage === "es") {
        // Function words, not topic words: they appear in any Spanish prose and
        // almost never in English, which keeps the check independent of subject.
        const hits = [" que ", " para ", " los ", " las ", " con ", " una ", " del ", " está", " más"]
          .filter((w) => text.toLowerCase().includes(w)).length;
        add("answered in Spanish", hits >= 4, `${hits}/9 Spanish function words`);
      }
    }
  } catch (err) {
    const reason = outageReason(err.message);
    if (reason) halted ??= reason;
    // `error` is a third state, not a failed check: the answer was never
    // produced, so nothing about its quality has been measured.
    out.push({ label: "case completed", ok: false, error: true, detail: err.message });
  }

  return out;
}

// --- Execution -------------------------------------------------------------

/** Run the cases with a small worker pool — a serial run of 30 cases is glacial. */
async function runAll(list) {
  const queue = [...list];
  const collected = new Map();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let t = queue.shift(); t && !halted; t = queue.shift()) {
      const attempts = [];
      for (let i = 0; i < REPEAT && !halted; i++) attempts.push(await runCase(t));
      collected.set(t.id, attempts);
    }
  });
  await Promise.all(workers);
  return collected;
}

console.log(
  `${c.bold}Evaluating ${cases.length} case(s)${c.off}${c.dim}` +
    `${REPEAT > 1 ? ` ×${REPEAT}` : ""} against ${BASE}${c.off}\n`,
);

const collected = await runAll(cases);

// Fold repeats into one verdict per check. A check that disagreed with itself
// is FLAKY: reported, but it neither passes nor fails the run, because
// punishing normal model variance would make the gate untrustworthy and
// therefore ignored.
const results = [];
for (const t of cases) {
  const attempts = collected.get(t.id) ?? [];
  const labels = [...new Set(attempts.flat().map((r) => r.label))];

  console.log(`${c.bold}${t.id}${c.off}  ${c.dim}${(t.tags ?? []).join(", ")}${c.off}`);
  for (const label of labels) {
    const runs = attempts.map((a) => a.find((r) => r.label === label)).filter(Boolean);
    const errored = runs.some((r) => r.error);
    const passes = runs.filter((r) => r.ok).length;
    const flaky = !errored && REPEAT > 1 && passes > 0 && passes < runs.length;
    const ok = !errored && passes * 2 > runs.length;
    const detail = (runs.find((r) => !r.ok)?.detail ?? "").replace(/\s+/g, " ").slice(0, 150);

    results.push({ key: `${t.id}::${label}`, caseId: t.id, label, ok, flaky, errored, tags: t.tags ?? [] });
    const mark = errored
      ? `${c.warn}!${c.off}`
      : flaky
        ? `${c.warn}~${c.off}`
        : ok
          ? `${c.pass}✓${c.off}`
          : `${c.fail}✗${c.off}`;
    const note = flaky ? `${c.dim}(${passes}/${runs.length})${c.off}` : ok || !detail ? "" : `${c.dim}${detail}${c.off}`;
    console.log(`  ${mark} ${label}  ${note}`);
  }
  console.log("");
}

const errored = results.filter((r) => r.errored);
const failed = results.filter((r) => !r.ok && !r.flaky && !r.errored);
const flaky = results.filter((r) => r.flaky);
const notRun = cases.filter((t) => !collected.has(t.id));
const scored = results.length - flaky.length - errored.length;
const pct = scored ? Math.round(((scored - failed.length) / scored) * 100) : 0;

console.log(`${c.bold}${scored - failed.length}/${scored} checks passed (${pct}%)${c.off}`);
if (flaky.length) console.log(`${c.warn}${flaky.length} flaky${c.off} (passed some repeats, failed others)`);
if (errored.length) console.log(`${c.warn}${errored.length} case(s) never produced an answer${c.off}`);
if (notRun.length) console.log(`${c.warn}${notRun.length} case(s) not attempted${c.off}`);

// --- Per-tag breakdown -----------------------------------------------------
// Which *kind* of quality slipped is the actionable part. An overall number
// tells you something is wrong; "grounding fell to 60%" tells you where.
const byTag = new Map();
for (const r of results) {
  for (const tag of r.tags) {
    const s = byTag.get(tag) ?? { pass: 0, total: 0 };
    if (!r.flaky && !r.errored) {
      s.total++;
      if (r.ok) s.pass++;
    }
    byTag.set(tag, s);
  }
}
if (byTag.size && !halted && errored.length + notRun.length <= cases.length * 0.25) {
  console.log(`\n${c.bold}By dimension${c.off}`);
  for (const [tag, s] of [...byTag].sort()) {
    const p = s.total ? Math.round((s.pass / s.total) * 100) : 0;
    const colour = p >= 90 ? c.pass : p >= 70 ? c.warn : c.fail;
    console.log(`  ${colour}${String(p).padStart(3)}%${c.off}  ${tag}  ${c.dim}${s.pass}/${s.total}${c.off}`);
  }
}

if (failed.length) {
  console.log(`\n${c.fail}Failing:${c.off}`);
  for (const f of failed) console.log(`  ${f.caseId} — ${f.label}`);
}

// --- Run validity ----------------------------------------------------------
//
// Decided before anything is scored or recorded. A run that could not reach the
// model has measured nothing, and the worst thing it can do is say so in the
// vocabulary of quality — a confident "59%, locale is broken" when the real
// answer was "the API key ran out of credit".
const incomplete = errored.length + notRun.length;
const invalid = !!halted || incomplete > cases.length * 0.25;

if (halted) {
  console.log(`\n${c.fail}RUN ABORTED — the provider stopped answering:${c.off}`);
  console.log(`  ${halted}`);
} else if (invalid) {
  console.log(`\n${c.fail}RUN INVALID — ${incomplete} of ${cases.length} cases never produced an answer.${c.off}`);
}
if (invalid) {
  console.log(`${c.dim}No score is reported and no baseline is touched: nothing about answer quality was measured.${c.off}`);
  process.exit(2);
}

// --- Baseline comparison ---------------------------------------------------
// The gate. An absolute pass rate is nearly meaningless on generative output —
// what matters is whether something that worked yesterday stopped working.
let regressed = [];
if (args["update-baseline"]) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        base: BASE,
        // Only checks that genuinely ran. A baseline is the thing every future
        // run is judged against, so a single bad entry mislabels a working
        // answer as a regression for as long as the file lives.
        checks: Object.fromEntries(results.filter((r) => !r.errored).map((r) => [r.key, r.ok])),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${c.dim}Baseline updated (${results.length} checks).${c.off}`);
} else if (existsSync(BASELINE_PATH)) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  regressed = results.filter((r) => !r.ok && !r.flaky && !r.errored && baseline.checks[r.key] === true);
  const fixed = results.filter((r) => r.ok && baseline.checks[r.key] === false);
  const added = results.filter((r) => baseline.checks[r.key] === undefined);

  console.log(`\n${c.bold}Against baseline${c.off} ${c.dim}(${baseline.recordedAt})${c.off}`);
  console.log(`  ${regressed.length ? c.fail : c.pass}${regressed.length} regressed${c.off}` +
    `  ${c.pass}${fixed.length} fixed${c.off}  ${c.dim}${added.length} new${c.off}`);
  for (const r of regressed) console.log(`  ${c.fail}↓${c.off} ${r.caseId} — ${r.label}`);
} else {
  console.log(`\n${c.dim}No baseline yet — run with --update-baseline to record one.${c.off}`);
}

if (args.json) {
  writeFileSync(
    args.json,
    `${JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, pct, results, regressed }, null, 2)}\n`,
  );
  console.log(`${c.dim}Report written to ${args.json}${c.off}`);
}

// Fail on a regression against the baseline, or on an outright collapse. The
// floor catches a first run with no baseline; the regression check is what
// catches a prompt edit that quietly made three answers worse.
const collapsed = pct < 70;
if (regressed.length) console.log(`\n${c.fail}FAILED: ${regressed.length} regression(s) against the baseline.${c.off}`);
else if (collapsed) console.log(`\n${c.fail}FAILED: pass rate ${pct}% is below the 70% floor.${c.off}`);
process.exit(regressed.length || collapsed ? 1 : 0);
