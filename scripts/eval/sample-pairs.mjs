#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pull claim/passage pairs out of real briefings, for a human to label.
//
//   node scripts/eval/sample-pairs.mjs --out=unlabelled.json --limit=40
//   node scripts/eval/sample-pairs.mjs --merge=labelled.json
//
// The 50 pairs in claim-pairs.json were written by hand to sit near the
// decision boundary. That is the right way to *build* a threshold and the wrong
// way to *evaluate* one: they were authored by the same people who chose the
// cut-offs, and they contain the cases those people thought of.
//
// This closes that loop. It reads claim checks that have actually run, samples
// the pairs the model found hardest, and writes them out with the verdict
// REMOVED — so whoever labels them is judging the pair, not agreeing with the
// machine. Labelling is a human step and there is no way around that; what this
// removes is every excuse not to do it.
//
// Sampling is deliberately biased towards the undecided band. A random sample
// of real pairs is mostly obvious ones, and obvious pairs move a threshold not
// at all.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { MongoClient } from "mongodb";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const PAIRS_PATH = new URL("./claim-pairs.json", import.meta.url);

const c = { bold: "\x1b[1m", dim: "\x1b[2m", off: "\x1b[0m", pass: "\x1b[32m", fail: "\x1b[31m" };

// --- merge -----------------------------------------------------------------
//
// Folding labelled pairs back in. Run separately from sampling so the labelling
// step is a file a person edits at their own pace, rather than a prompt.
if (args.merge) {
  const incoming = JSON.parse(readFileSync(args.merge, "utf8"));
  const existing = JSON.parse(readFileSync(PAIRS_PATH, "utf8"));
  const byId = new Map(existing.pairs.map((p) => [p.id, p]));

  let added = 0;
  let skipped = 0;
  for (const p of incoming.pairs ?? incoming) {
    if (typeof p.supports !== "boolean") {
      console.log(`  ${c.dim}unlabelled, skipped: ${p.id}${c.off}`);
      skipped++;
      continue;
    }
    if (byId.has(p.id)) {
      skipped++;
      continue;
    }
    byId.set(p.id, {
      id: p.id,
      kind: p.kind ?? "real",
      supports: p.supports,
      claim: p.claim,
      passage: p.passage,
    });
    added++;
  }

  existing.pairs = [...byId.values()];
  writeFileSync(PAIRS_PATH, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`${c.pass}Merged ${added} pair(s)${c.off}${skipped ? `, skipped ${skipped}` : ""}.`);
  console.log(`${c.dim}claim-pairs.json now holds ${existing.pairs.length}. Re-run: npm run eval:claims${c.off}`);
  process.exit(0);
}

// --- sample ----------------------------------------------------------------
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is required (load it with --env-file-if-exists=.env.local).");
  process.exit(1);
}

const limit = Number(args.limit ?? 40);
const out = args.out ?? "unlabelled-pairs.json";
if (existsSync(out) && !args.force) {
  console.error(`${out} already exists. Pass --force to overwrite.`);
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "scrutan");

const reports = await db.collection("claimReports").find({}).toArray();
await client.close();

const candidates = [];
for (const report of reports) {
  for (const v of report.verdicts ?? []) {
    // A pair needs both halves. An unavailable or uncited verdict has no
    // passage, so there is nothing for a labeller to judge.
    if (!v.passage || v.score === null || v.score === undefined) continue;
    candidates.push({
      id: `real-${report._id.slice(0, 8)}-${v.index}`,
      claim: v.text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim(),
      passage: v.passage,
      score: v.score,
    });
  }
}

if (candidates.length === 0) {
  console.error(
    "No stored claim checks to sample from. Run the claim check on a few real projects first.",
  );
  process.exit(1);
}

/**
 * Prefer pairs the model could not decide.
 *
 * Distance from the middle of the undecided band, ascending: the pairs sitting
 * exactly where the thresholds live are the ones whose labels would actually
 * move a threshold. A pair scoring 0.95 or 0.05 tells a labeller's time nothing.
 */
const MID = Number(process.env.SAMPLE_CENTRE ?? 0.51);
candidates.sort((a, b) => Math.abs(a.score - MID) - Math.abs(b.score - MID));

const sampled = candidates.slice(0, limit).map((p) => ({
  id: p.id,
  kind: "real",
  // The verdict is deliberately absent. Handing a labeller the machine's answer
  // turns labelling into review, and review agrees with the machine far more
  // often than an independent judgement does.
  supports: null,
  claim: p.claim,
  passage: p.passage,
}));

writeFileSync(
  out,
  `${JSON.stringify(
    {
      description:
        "Unlabelled claim/passage pairs sampled from real Scrutan briefings. For each, set " +
        '"supports" to true if the passage, read on its own, would let a reasonable person say ' +
        "the claim is stated by this source — and false otherwise. Do not look up how Scrutan " +
        "scored them; the point is an independent judgement. Then: node scripts/eval/sample-pairs.mjs --merge=<this file>",
      sampledFrom: reports.length,
      candidates: candidates.length,
      pairs: sampled,
    },
    null,
    2,
  )}\n`,
);

console.log(`${c.bold}Sampled ${sampled.length} pair(s)${c.off} from ${reports.length} stored check(s).`);
console.log(`${c.dim}${candidates.length} candidates; kept the ones nearest the decision boundary.${c.off}`);
console.log(`\nWritten to ${c.bold}${out}${c.off}`);
console.log(`${c.dim}Label each pair's "supports" field, then merge them:${c.off}`);
console.log(`  node scripts/eval/sample-pairs.mjs --merge=${out}`);
