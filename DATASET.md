# The claim-support dataset

`scripts/eval/claim-pairs.json` — hand-labelled claim/passage pairs, used to set the two
thresholds that decide whether Scrutan calls a claim *stated*, *related* or *not in the
source*.

It is published because the thresholds are the load-bearing numbers in this product, and a
threshold whose justification cannot be inspected is the same kind of claim as an uncited
statistic.

## What a pair is

```json
{
  "id": "waste-para",
  "kind": "paraphrase",
  "supports": true,
  "claim": "Roughly a third of food prepared in college hostel messes is thrown away.",
  "passage": "Surveys of residential campus kitchens found that about 33 percent of cooked
              food never reaches a plate and is discarded at the end of service."
}
```

`supports` is true when the passage, **read on its own**, would let a reasonable person say
the claim is stated by this source. Not "is on the same topic as", and not "is consistent
with" — stated.

## The `kind` field

Every pair is labelled with why it exists, because a set of only easy pairs would place a
threshold anywhere and look convincing doing it.

| kind | polarity | what it tests |
|---|---|---|
| `paraphrase` | positive | the same fact in different words |
| `embedded` | positive | the fact stated inside a longer passage about other things |
| `partial` | positive | stated, but less precisely than the claim |
| `adjacent` | negative | same topic, a neighbouring fact, not this one |
| `contradictory` | negative | the passage states the opposite or a different magnitude |
| `generic` | negative | boilerplate about the domain that asserts nothing specific |
| `unrelated` | negative | a different subject entirely |

`adjacent` and `contradictory` carry the weight. Unrelated text is easy to reject and no
threshold is decided by it.

## How it is used

```bash
npm run eval:claims            # sweep both thresholds, print the table
npm run eval:claims -- --assert  # the same, as a pass/fail gate (runs in CI)
npm run eval:claims -- --model=lexical --entail=none   # ablations
```

The sweep picks each cut-off by a stated rule rather than by eye: the *supported* bar is the
lowest with ≥95% precision, the *weak* bar the highest with ≥95% recall. Thresholds are
stored **per embedding model**, because the two models this repo ships live in different
numeric ranges.

## What this dataset is not

**It is not a benchmark, and numbers measured on it are not accuracy figures.** Three limits,
in descending order of how much they should bother you:

1. **The pairs were written by the same people who chose the thresholds.** They contain the
   cases those people thought of. That is the correct way to *build* a decision boundary and
   the wrong way to *evaluate* one.
2. **They were written to sit near the boundary.** The class balance is deliberate, not
   natural, so a precision figure here does not predict precision on a real briefing where
   most pairs are obvious.
3. **Fifty pairs is a coarse instrument.** One relabelled pair moves precision by two points.

## Fixing that

`npm run eval:sample` reads claim checks that have actually run, samples the pairs the model
found hardest, and writes them out **with the verdict removed** — so whoever labels them is
judging the pair rather than agreeing with the machine. Labelling is a human step and there
is no way around it; what the tool removes is every excuse not to do it.

There are two ways to get pairs, depending on whether real briefings exist yet.

```bash
# From briefings already checked in this deployment:
npm run eval:sample   -- --out=unlabelled.json --limit=40

# Or generate fresh ones. Runs the real pipeline — live model, live search —
# on seed ideas spread across domains, and costs API credit. Nothing is
# written to the database, and it refuses to run on the mock provider rather
# than calibrate the thresholds against templated text.
npm run eval:generate -- --ideas=5 --out=unlabelled.json

# ... a person sets "supports" on each pair ...
node scripts/eval/sample-pairs.mjs --merge=unlabelled.json
npm run eval:claims
```

**Who labels them matters more than how many.** The first limitation above is that the
pairs were written by whoever chose the thresholds; labelling the new ones yourself
reproduces exactly that bias, and does so while looking like independent validation, which
is worse than the current state. Give the file to someone who did not pick the cut-offs.

Pairs merged this way are marked `"kind": "real"`. When those outnumber the hand-written
ones, the numbers in this repo stop being a calibration and start being a result — and this
section should be rewritten to say so.

## Licence

The pairs are original text written for this purpose, not excerpts from third-party sources.
Use them freely; attribution to the Scrutan repository is appreciated.
