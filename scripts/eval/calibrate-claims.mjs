#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Calibrating the claim-support thresholds.
//
//   npm run eval:claims                  # sweep and report
//   npm run eval:claims -- --model=lexical
//   npm run eval:claims -- --json=out.json
//
// src/lib/verify/claims.ts turns a similarity into one of three verdicts, and
// where the two cut-offs sit decides what the feature says about a briefing.
// Choosing them by eye would make the whole check a matter of taste — which is
// the thing this product refuses to accept from anyone else.
//
// So they are chosen against a hand-labelled set, by a stated rule:
//
//   SUPPORTED_AT  the lowest threshold at which calling something "supported"
//                 is right at least PRECISION_TARGET of the time. Vouching for
//                 a claim the source does not make is the product-fatal error:
//                 it is the flattery Scrutan exists to refuse, wearing a badge.
//
//   WEAK_AT       the highest threshold that still catches at least
//                 RECALL_TARGET of genuinely supported claims. Below this we
//                 say "not in the source", which is an accusation, and an
//                 accusation should be made only when it is nearly always right.
//
// The gap between them is the "weak" band — the region where the evidence does
// not settle the question. Its width is a measured property of the embedder,
// not a design choice, and a wide band is information: it says this model
// cannot separate these cases, which is exactly what the lexical run shows.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const PRECISION_TARGET = Number(args.precision ?? 0.95);
const RECALL_TARGET = Number(args.recall ?? 0.95);

const c = {
  bold: "\x1b[1m", dim: "\x1b[2m", off: "\x1b[0m",
  pass: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m",
};

const { pairs, description } = JSON.parse(
  readFileSync(new URL("./claim-pairs.json", import.meta.url), "utf8"),
);

const { makeEmbedder, cosine } = await import("../../src/lib/similarity/index.ts");
const { figuresMissingFrom, refutationIn } = await import("../../src/lib/verify/claims.ts");
const which = args.model === "lexical" ? "lexical" : "neural";
const embedder = makeEmbedder(which);

console.log(`${c.bold}Claim-support calibration${c.off}  ${c.dim}${embedder.label}${c.off}`);
console.log(`${c.dim}${pairs.length} labelled pairs${c.off}\n`);

// Score every pair once; the sweep is then pure arithmetic.
//
// The guards are evaluated here too, because the product does not decide on
// similarity alone and a sweep that ignored them would calibrate a function
// nobody calls. A pair the guards catch can never be labelled "supported"
// however high it scores, so it is excluded from the precision numerator the
// same way it is in claims.ts.
const scored = [];
for (const p of pairs) {
  const [a, b] = await embedder.embedAll([p.claim, p.passage]);
  const refuted = refutationIn(p.passage, p.claim);
  const missing = figuresMissingFrom(p.claim, p.passage);
  scored.push({
    ...p,
    score: cosine(a, b),
    guard: refuted ? "refutation" : missing.length ? "figure" : null,
    guardDetail: refuted ?? missing.join(", ") ?? null,
  });
}

const guarded = scored.filter((p) => p.guard);
const caughtNegatives = guarded.filter((p) => !p.supports).length;
console.log(`${c.bold}Literal guards${c.off}  ${c.dim}applied before any threshold${c.off}`);
console.log(
  `  ${caughtNegatives} of ${scored.filter((p) => !p.supports).length} negatives caught outright` +
    `  ${c.dim}(${guarded.filter((p) => p.supports).length} positives wrongly caught)${c.off}`,
);
for (const p of guarded) {
  const mark = p.supports ? `${c.fail}✗ positive${c.off}` : `${c.pass}✓ negative${c.off}`;
  console.log(`    ${mark} ${p.id} ${c.dim}(${p.guard}: ${p.guardDetail})${c.off}`);
}
console.log("");

const positives = scored.filter((p) => p.supports);
const negatives = scored.filter((p) => !p.supports);

/**
 * Precision and recall for "call it supported at or above `t`".
 *
 * A guarded pair is never called supported, so it cannot be a true or false
 * positive — which is the whole reason the guards exist.
 */
function at(t) {
  const tp = positives.filter((p) => p.score >= t && !p.guard).length;
  const fp = negatives.filter((p) => p.score >= t && !p.guard).length;
  const fn = positives.length - tp;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = positives.length === 0 ? 0 : tp / positives.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { t, tp, fp, fn, precision, recall, f1 };
}

const steps = [];
for (let t = 0; t <= 0.95001; t += 0.01) steps.push(at(Number(t.toFixed(2))));

const pctOf = (x) => `${(x * 100).toFixed(0)}%`.padStart(4);

console.log(`${c.bold}Sweep${c.off}  ${c.dim}(precision/recall of the "supported" label)${c.off}`);
console.log(`${c.dim}  thresh  precision  recall    F1   fp  fn${c.off}`);
for (const s of steps.filter((s) => Math.round(s.t * 100) % 5 === 0)) {
  const colour = s.precision >= PRECISION_TARGET ? c.pass : s.precision >= 0.8 ? c.warn : c.fail;
  console.log(
    `   ${s.t.toFixed(2)}     ${colour}${pctOf(s.precision)}${c.off}     ${pctOf(s.recall)}  ${pctOf(s.f1)}   ${String(s.fp).padStart(2)}  ${String(s.fn).padStart(2)}`,
  );
}

// The two rules.
const supportedAt = steps.find((s) => s.precision >= PRECISION_TARGET) ?? null;
const weakCandidates = steps.filter((s) => s.recall >= RECALL_TARGET);
const weakAt = weakCandidates.length ? weakCandidates[weakCandidates.length - 1] : null;
const best = steps.reduce((a, b) => (b.f1 > a.f1 ? b : a));

console.log(`\n${c.bold}Chosen${c.off}`);
if (supportedAt) {
  console.log(
    `  SUPPORTED_AT = ${c.bold}${supportedAt.t.toFixed(2)}${c.off}  ${c.dim}precision ${pctOf(supportedAt.precision).trim()}, recall ${pctOf(supportedAt.recall).trim()} — lowest bar meeting the ${pctOf(PRECISION_TARGET).trim()} precision target${c.off}`,
  );
} else {
  console.log(`  ${c.fail}SUPPORTED_AT — no threshold reaches ${pctOf(PRECISION_TARGET).trim()} precision.${c.off}`);
  console.log(`  ${c.dim}This model cannot say "supported" reliably at any cut-off.${c.off}`);
}
if (weakAt) {
  console.log(
    `  WEAK_AT      = ${c.bold}${weakAt.t.toFixed(2)}${c.off}  ${c.dim}recall ${pctOf(weakAt.recall).trim()} — highest bar still catching ${pctOf(RECALL_TARGET).trim()} of supported claims${c.off}`,
  );
} else {
  console.log(`  ${c.fail}WEAK_AT — no threshold retains ${pctOf(RECALL_TARGET).trim()} recall.${c.off}`);
}
if (supportedAt && weakAt) {
  const width = supportedAt.t - weakAt.t;
  const undecided = scored.filter((p) => p.score >= weakAt.t && p.score < supportedAt.t).length;
  const colour = width > 0.3 ? c.fail : width > 0.15 ? c.warn : c.pass;
  console.log(
    `  ${c.dim}"weak" band${c.off}   ${colour}${weakAt.t.toFixed(2)} – ${supportedAt.t.toFixed(2)}${c.off}  ${c.dim}(${width.toFixed(2)} wide; ${undecided} of ${scored.length} pairs land in it undecided)${c.off}`,
  );
}
console.log(`  ${c.dim}best F1 overall is ${pctOf(best.f1).trim()} at ${best.t.toFixed(2)}, for reference${c.off}`);

// Separation, the same way lib/similarity documents it.
const range = (xs) =>
  xs.length ? `${Math.min(...xs).toFixed(3)} – ${Math.max(...xs).toFixed(3)}` : "—";
console.log(`\n${c.bold}Score ranges${c.off}`);
console.log(`  ${c.dim}supported  ${range(positives.map((p) => p.score))}${c.off}`);
console.log(`  ${c.dim}not        ${range(negatives.map((p) => p.score))}${c.off}`);
const overlap = Math.min(...positives.map((p) => p.score)) <= Math.max(...negatives.map((p) => p.score));
console.log(
  overlap
    ? `  ${c.warn}the ranges overlap — no single threshold separates them, which is why there are two${c.off}`
    : `  ${c.pass}the ranges are disjoint${c.off}`,
);

console.log(`\n${c.bold}By pair kind${c.off}  ${c.dim}(mean score)${c.off}`);
const kinds = new Map();
for (const p of scored) {
  const k = kinds.get(p.kind) ?? { sum: 0, n: 0, supports: p.supports };
  k.sum += p.score;
  k.n++;
  kinds.set(p.kind, k);
}
for (const [kind, k] of [...kinds].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)) {
  const mean = k.sum / k.n;
  console.log(
    `  ${(k.supports ? c.pass + "+" : c.dim + "−") + c.off} ${kind.padEnd(14)} ${mean.toFixed(3)}  ${c.dim}n=${k.n}${c.off}`,
  );
}

// The pairs that would be got wrong at the chosen settings.
if (supportedAt && weakAt) {
  const wrong = scored.filter(
    (p) =>
      (p.supports && (p.score < weakAt.t || p.guard)) ||
      (!p.supports && p.score >= supportedAt.t && !p.guard),
  );
  console.log(`\n${c.bold}Would be misjudged at these settings${c.off}  ${c.dim}${wrong.length} of ${scored.length}${c.off}`);
  for (const p of wrong) {
    const what = p.supports ? `${c.fail}called unsupported${c.off}` : `${c.fail}called supported${c.off}`;
    console.log(`  ${p.id} ${c.dim}(${p.kind}, ${p.score.toFixed(3)})${c.off} — ${what}`);
  }
  if (wrong.length === 0) console.log(`  ${c.pass}none${c.off}`);
}

if (args.json) {
  writeFileSync(
    args.json,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        model: embedder.id,
        pairs: scored.length,
        description,
        targets: { precision: PRECISION_TARGET, recall: RECALL_TARGET },
        chosen: { supportedAt: supportedAt?.t ?? null, weakAt: weakAt?.t ?? null },
        sweep: steps,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${c.dim}Written to ${args.json}${c.off}`);
}

console.log(
  `\n${c.dim}These pairs are hand-written to sit near the boundary. They calibrate the thresholds; they do not measure accuracy on real briefings.${c.off}`,
);
