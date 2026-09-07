#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Produce claim/passage pairs from real briefings, for a human to label.
//
//   npm run eval:generate -- --ideas=5 --out=unlabelled.json
//
// The 50 pairs the thresholds rest on were written by hand. That is the right
// way to *build* a decision boundary and the wrong way to *evaluate* one:
// they were authored by whoever chose the cut-offs, and they contain the cases
// that person thought of. DATASET.md says so at length.
//
// Closing that needs pairs from output nobody designed. This runs the real
// pipeline on seed ideas — live model, live search — checks the resulting
// claims, and writes out the pairs the checker found hardest, with the verdict
// REMOVED. What comes out is a file a person labels. There is no way around the
// person; what this removes is every excuse.
//
// COSTS REAL MONEY. One model call and a handful of searches per idea, so the
// default is deliberately small. Nothing is written to the database.
// ---------------------------------------------------------------------------

import { writeFileSync, existsSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const c = { bold: "\x1b[1m", dim: "\x1b[2m", off: "\x1b[0m", pass: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m" };

const { getPipeline } = await import("../../src/lib/pipeline/index.ts");
const { verifyClaims } = await import("../../src/lib/verify/claims.ts");
const { getProvider } = await import("../../src/lib/ai/index.ts");

/**
 * Seed ideas, spread across domains on purpose.
 *
 * A set of pairs drawn from five variations of one idea would calibrate the
 * thresholds for that idea. The spread is what makes the resulting pairs worth
 * more than the hand-written ones they are meant to supplement.
 */
const SEEDS = [
  "A tool that helps hostel kitchens predict how many students will eat dinner",
  "An app that matches undergraduates to research labs by their coursework",
  "A low-cost sensor network for classroom air quality in government schools",
  "A platform that helps smallholder farmers time irrigation from soil moisture",
  "A system that flags which municipal drains are most likely to cause flooding",
  "A service that checks whether a rooftop solar quote is priced fairly",
  "An assistant that prepares students for viva questions from their own report",
  "A marketplace matching final-year projects to companies that would sponsor them",
];

const count = Math.min(Number(args.ideas ?? 5), SEEDS.length);
const out = args.out ?? "unlabelled-pairs.json";
if (existsSync(out) && !args.force) {
  console.error(`${out} already exists. Pass --force to overwrite.`);
  process.exit(1);
}

const provider = getProvider();
if (provider.isMock) {
  console.error(
    `${c.fail}No live model is configured, so this would generate mock text.${c.off}\n` +
      "Mock output is templated, and pairs drawn from it would calibrate the thresholds\n" +
      "against a template rather than against real writing. Set ANTHROPIC_API_KEY or\n" +
      "OPENAI_API_KEY and try again.",
  );
  process.exit(2);
}

console.log(`${c.bold}Generating ${count} briefing(s)${c.off} ${c.dim}with ${provider.label ?? provider.id ?? "the live provider"}${c.off}`);
console.log(`${c.dim}This spends API credit. Nothing is written to the database.${c.off}\n`);

const pipeline = getPipeline();
const pairs = [];
let briefings = 0;

for (const idea of SEEDS.slice(0, count)) {
  process.stdout.write(`  ${idea.slice(0, 58).padEnd(60)}`);
  try {
    const research = await pipeline.deepSearch({ idea, locale: "en" });
    if (!research?.summaryMarkdown || (research.citations ?? []).length === 0) {
      console.log(`${c.warn}no citations${c.off}`);
      continue;
    }
    if (research.demo) {
      console.log(`${c.warn}fell back to demo output — skipped${c.off}`);
      continue;
    }

    const report = await verifyClaims({
      markdown: research.summaryMarkdown,
      citations: research.citations,
    });
    briefings++;

    let kept = 0;
    for (const v of report.verdicts) {
      // A pair needs both halves. Unavailable and uncited verdicts have no
      // passage, so there is nothing for a labeller to judge.
      if (!v.passage || v.score === null) continue;
      pairs.push({
        id: `real-${briefings}-${v.index}`,
        kind: "real",
        // Absent on purpose: handing a labeller the machine's answer turns
        // labelling into review, and review agrees with the machine far more
        // often than an independent judgement does.
        supports: null,
        claim: v.text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim(),
        passage: v.passage,
        _score: v.score,
      });
      kept++;
    }
    console.log(`${c.pass}${kept} pair(s)${c.off} ${c.dim}from ${research.citations.length} sources${c.off}`);
  } catch (err) {
    console.log(`${c.fail}failed${c.off} ${c.dim}${err instanceof Error ? err.message.slice(0, 60) : err}${c.off}`);
  }
}

if (pairs.length === 0) {
  console.error(`\n${c.fail}No pairs produced.${c.off}`);
  process.exit(1);
}

// Keep the pairs nearest the decision boundary. A random sample of real pairs
// is mostly obvious ones, and obvious pairs move a threshold not at all.
const MID = Number(process.env.SAMPLE_CENTRE ?? 0.51);
pairs.sort((a, b) => Math.abs(a._score - MID) - Math.abs(b._score - MID));
const limit = Number(args.limit ?? 40);
const sampled = pairs.slice(0, limit).map(({ _score, ...p }) => {
  void _score;
  return p;
});

writeFileSync(
  out,
  `${JSON.stringify(
    {
      description:
        "Unlabelled claim/passage pairs from real Scrutan briefings. For each, set " +
        '"supports" to true if the passage, read on its own, would let a reasonable person ' +
        "say the claim is stated by this source — and false otherwise. Judge the pair; do " +
        "not look up how Scrutan scored it. Then merge: node scripts/eval/sample-pairs.mjs --merge=<this file>",
      briefings,
      candidates: pairs.length,
      pairs: sampled,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${c.bold}${sampled.length} pair(s)${c.off} written to ${c.bold}${out}${c.off}`);
console.log(`${c.dim}${pairs.length} candidates from ${briefings} briefing(s); kept those nearest the boundary.${c.off}`);
console.log(`\n${c.bold}Next, and it needs a person:${c.off}`);
console.log(`  1. Set "supports" on each pair — true or false.`);
console.log(`  2. node scripts/eval/sample-pairs.mjs --merge=${out}`);
console.log(`  3. npm run eval:claims`);
console.log(
  `\n${c.dim}Label them yourself, or better, have someone who did not choose the thresholds do it.${c.off}`,
);
