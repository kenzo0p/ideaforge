import { getEmbedder } from "@/lib/similarity";
import { cosine } from "@/lib/similarity/types";
import { chunkWords, normaliseText } from "./chunk";
import { fetchPageText, mapLimit } from "./page";
import { segment, type Sentence } from "./segment";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// Does the source actually say this?
//
// Citation verification answers a weaker question than most people assume it
// does. It establishes that a URL resolves and that the page is broadly about
// what it was cited as. It cannot catch the failure that matters most: a real,
// live, on-topic source attached to a sentence it never contained.
//
//   "Food waste in Indian hostels costs ₹40 crore annually [3]"
//
// Source 3 can be a genuine article about hostel food waste, fetch with a 200,
// match its own title perfectly — and contain no such figure anywhere. Every
// check in this codebase up to now passes that claim.
//
// So this does retrieval instead of reachability:
//
//   1. cut the briefing into sentences, keeping the [n] markers  (segment.ts)
//   2. fetch each cited source once and cut it into overlapping passages
//   3. embed the claim and every passage with the local model
//   4. the best-matching passage is the evidence, and its score is the support
//   5. separately, check that any figure in the claim appears in the source
//
// Step 5 exists because embeddings are almost blind to numbers. "costs ₹40
// crore" and "costs ₹400 crore" are nearly identical vectors, and a fabricated
// statistic is the single most damaging thing this product could pass on. The
// arithmetic is checked literally, not semantically.
// ---------------------------------------------------------------------------

export type SupportKind =
  /** A passage in a cited source says this. */
  | "supported"
  /** The source addresses this and appears to say the opposite. */
  | "contradicted"
  /** Related material, but nothing that plainly states the claim. */
  | "weak"
  /** Nothing in the cited sources resembles it. */
  | "unsupported"
  /** The sources could not be read, so nothing was established either way. */
  | "unavailable"
  /** A figure asserted with no citation at all. */
  | "uncited";

export interface ClaimVerdict {
  index: number;
  /** The sentence as written, markers included. */
  text: string;
  citationIds: number[];
  kind: SupportKind;
  /** Best passage similarity found, 0–1. Null when nothing could be compared. */
  score: number | null;
  /** Which citation produced the best passage. */
  sourceId: number | null;
  /** The passage itself — the evidence a reader can check against the source. */
  passage: string | null;
  /** Figures in the claim that appear nowhere in its cited sources. */
  unmatchedFigures: string[];
  note: string;
}

export interface ClaimReport {
  verdicts: ClaimVerdict[];
  contradicted: number;
  /** The cut-offs used, or null when the model has none and nothing was judged. */
  thresholds: Thresholds | null;
  /** Supported ÷ claims that were actually checkable. The headline number. */
  supportScore: number;
  supported: number;
  weak: number;
  unsupported: number;
  unavailable: number;
  uncited: number;
  /** Which embedder scored this; a degraded model must be visible downstream. */
  model: string;
  checkedAt: number;
}

/**
 * Where a passage stops being "related" and starts being "says this".
 *
 * Measured, not chosen, and **measured per model**. `npm run eval:claims`
 * sweeps both cut-offs against 50 hand-labelled claim/passage pairs and picks
 * them by a stated rule:
 *
 *   supported  the lowest bar at which "supported" is right ≥95% of the time.
 *              Vouching for a claim the source does not make is the
 *              product-fatal error — flattery wearing a badge — so this end is
 *              tuned for precision and pays for it in recall.
 *
 *   weak       the highest bar still catching ≥95% of genuinely supported
 *              claims. Below it we say "not in the source", which is an
 *              accusation, and an accusation should almost never be wrong.
 *
 * The band between them is where the evidence does not settle the question, and
 * most true claims land there: on MiniLM, recall at the supported bar is 23%, so
 * roughly three in four supported claims are reported `weak` rather than
 * confirmed. That is the honest reading of what this embedder can establish, and
 * it is why `weak` reads as "related, not stated" rather than as a soft pass.
 *
 * KEYED BY MODEL, and that is not tidiness. The two embedders live in different
 * numeric ranges — MiniLM's supported pairs span 0.299–0.770, the lexical
 * fallback's span 0.129–0.372. Running the fallback against MiniLM's cut-offs
 * would put *every* claim below the weak bar, and the product would tell every
 * user that their entire briefing was fabricated. A shared constant here is a
 * defamation engine one environment variable away.
 *
 * Two caveats belong next to the numbers. Fifty pairs is a coarse instrument —
 * one label flips precision by two points — and the pairs were hand-written to
 * sit near the boundary, so they calibrate the thresholds without measuring
 * accuracy on real briefings.
 */
export interface Thresholds {
  supported: number;
  weak: number;
}

const CALIBRATED: Record<string, Thresholds> = {
  // 100% precision / 23% recall, and 95% recall, on the 50-pair set.
  minilm: { supported: 0.59, weak: 0.43 },
  // 100% / 32%, and 95%. Better recall than MiniLM at the supported bar, but
  // its supported and unsupported ranges overlap far more (0.129–0.372 against
  // 0.096–0.316), so the band decides very little.
  lexical: { supported: 0.28, weak: 0.14 },
};

/**
 * The cut-offs for a model, or null when nobody has measured it.
 *
 * Null is a real answer and the caller must handle it. Guessing a threshold for
 * an unmeasured model produces verdicts that look exactly like measured ones,
 * which is the single worst thing this file could do.
 */
function thresholdsFor(model: string): Thresholds | null {
  const supported = Number(process.env.CLAIM_SUPPORTED_AT);
  const weak = Number(process.env.CLAIM_WEAK_AT);
  // An override is all-or-nothing: half a calibration is not a calibration.
  if (Number.isFinite(supported) && Number.isFinite(weak)) return { supported, weak };
  return CALIBRATED[model] ?? null;
}

/** Claims scored in one pass. A briefing far past this is not a briefing. */
const MAX_CLAIMS = 120;
/** Passages embedded in one pass, across all sources together. */
const MAX_CHUNKS = 1000;
const CONCURRENCY = 4;

/** Scale words that make a bare number meaningful. */
const SCALE = "crore|lakh|billion|million|thousand|trillion|bn|mn|k";

/**
 * Number words, and the units that make one a quantity rather than an article.
 *
 * "under six years" and "eleven or twelve years" disagree, and neither contains
 * a digit — so a digits-only figure check reads them as compatible. Spelled
 * numbers are only extracted next to a unit, because "one of the reasons" and
 * "a hundred other things" are prose, not measurements.
 */
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
};
const UNITS = "per\\s?cents?|percent|years?|months?|weeks?|days?|hours?|minutes?|times|fold|crore|lakh|million|billion|thousand";

/**
 * Phrases that refute rather than support.
 *
 * Narrow on purpose, and every entry is an explicit refutation rather than a
 * mere negative word. "without" and "not" appear constantly in ordinary prose;
 * "found no significant" does not. High precision, low recall — this catches
 * the stated denial and nothing subtler, which is the honest limit of a lexical
 * method. Detecting that "rainfall was the dominant factor" contradicts
 * "drainage, not rainfall, was the cause" needs an entailment model, and
 * pretending otherwise would be the failure this file is about.
 */
const REFUTATIONS = [
  "no significant", "no statistically significant", "not statistically significant",
  "found no", "find no", "found little", "no evidence", "no such",
  "no difference", "little difference", "no measurable", "no discernible",
  "did not find", "failed to find", "was unchanged", "were unchanged",
  "remained unchanged", "no correlation", "no association", "no benefit",
];

/**
 * Numbers worth checking literally.
 *
 * Bare small integers are excluded deliberately. "three of the five vendors"
 * puts a 3 and a 5 in the claim, both of which occur on almost any page, so
 * checking them would produce matches that mean nothing and misses that mean
 * less. What survives is what a reader would call a statistic: a percentage, an
 * amount of money, a year, a large number, or a number with a scale word.
 */
export interface Figure {
  /** As written, for showing a reader. */
  display: string;
  /** Digits used for matching. */
  core: string;
}

function extractFigures(text: string): Figure[] {
  const out = new Set<string>();
  const patterns = [
    // 31.2%, 22 %
    /\d[\d,]*(?:\.\d+)?\s*%/g,
    // ₹40.5 crore, $2.3 billion, Rs 1,200
    new RegExp(`(?:[₹$€£]|\\b(?:rs|inr|usd|eur)\\b\\.?)\\s*\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:${SCALE}))?`, "gi"),
    // 40 crore, 2.3 million
    new RegExp(`\\d[\\d,]*(?:\\.\\d+)?\\s*(?:${SCALE})\\b`, "gi"),
    // Years, which date a claim and are cheap to fabricate
    /\b(?:19|20)\d{2}\b/g,
    // Any number with a decimal point or four-plus digits
    /\b\d[\d,]{3,}(?:\.\d+)?\b|\b\d+\.\d+\b/g,
    // Spelled-out quantities: "six years", "forty per cent"
    new RegExp(`\\b(?:${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:${UNITS})\\b`, "gi"),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.add(m[0].trim());
  }

  // The patterns overlap on purpose — "₹47.3 million" is matched by three of
  // them — so the same number arrives under several spellings. Reporting it
  // three times would make one fabricated figure look like three.
  const byNumber = new Map<string, string>();
  for (const figure of out) {
    const core = figureCore(figure);
    if (!core) continue;
    const existing = byNumber.get(core);
    // Keep the fullest rendering: "₹47.3 million" tells a reader more than "47.3".
    if (!existing || figure.length > existing.length) byNumber.set(core, figure);
  }
  return [...byNumber].map(([core, display]) => ({ display, core }));
}

/**
 * The digits inside a figure, for matching.
 *
 * Matching on the rendered form would fail on every difference of formatting —
 * "₹40 crore" against "Rs. 40 crore", "1,200" against "1200". The number is the
 * part that can be fabricated; the currency symbol is not.
 */
function figureCore(figure: string): string {
  const flat = figure.replace(/,/g, "");
  const digits = flat.match(/\d+(?:\.\d+)?/);
  if (digits) return digits[0];
  const word = flat.toLowerCase().match(/^[a-z]+/);
  return word ? (NUMBER_WORDS[word[0]] ?? "") : "";
}

/**
 * Does this number appear anywhere in the source text?
 *
 * Checked in both notations, because the claim and the source need not agree on
 * spelling: "six years" in one and "6 years" in the other is a match, and
 * treating it as a mismatch would manufacture a finding out of a style choice.
 */
function figurePresent(core: string, haystack: string): boolean {
  if (!core) return true;
  // Word-boundary matched so 40 does not match 4007, but "40.5" still matches
  // inside "₹40.5cr".
  if (new RegExp(`(?<![\\d.])${core.replace(".", "\\.")}(?![\\d])`).test(haystack)) return true;
  const word = Object.keys(NUMBER_WORDS).find((w) => NUMBER_WORDS[w] === core);
  return word ? new RegExp(`\\b${word}\\b`, "i").test(haystack) : false;
}

/** Figures asserted by `claim` that appear nowhere in `text`. Exported for calibration. */
export function figuresMissingFrom(claim: string, text: string): string[] {
  const haystack = text.replace(/,/g, "");
  return extractFigures(claim)
    .filter((f) => !figurePresent(f.core, haystack))
    .map((f) => f.display);
}

/** Words too common to show that two pieces of text are about the same thing. */
const COMMON = new Set([
  "the", "and", "for", "that", "this", "with", "from", "was", "were", "are",
  "have", "has", "had", "not", "but", "than", "then", "which", "their", "there",
  "been", "into", "more", "most", "some", "such", "also", "over", "under",
  "about", "would", "could", "should", "found", "study", "report", "data",
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

/**
 * A denial in `passage` that is about what `claim` is about.
 *
 * The subject test is what makes this usable. Calibration caught the guard
 * firing on a passage that genuinely supported its claim — "over-preparation
 * fell noticeably … though procurement costs were unchanged" — because a
 * refutation phrase appeared somewhere in sixty words, attached to a different
 * quantity entirely. A denial of something else is not a denial of this.
 *
 * So the words around the phrase must overlap the claim's own. Crude, and it
 * will miss a denial phrased with none of the claim's vocabulary; the failure
 * direction is a missed contradiction rather than a fabricated one, which is
 * the right way round for something that accuses.
 */
export function refutationIn(passage: string, claim?: string): string | null {
  const flat = passage.toLowerCase().replace(/\s+/g, " ");
  const claimWords = claim ? contentWords(claim) : null;

  for (const phrase of REFUTATIONS) {
    const at = flat.indexOf(phrase);
    if (at === -1) continue;
    if (!claimWords || claimWords.size === 0) return phrase;

    // Roughly ten words either side of the phrase — the clause it belongs to.
    const before = flat.slice(Math.max(0, at - 70), at);
    const after = flat.slice(at + phrase.length, at + phrase.length + 70);
    const near = contentWords(`${before} ${after}`);
    if ([...near].some((w) => claimWords.has(w))) return phrase;
  }
  return null;
}

interface SourceText {
  id: number;
  chunks: string[];
  vectors: number[][];
  /** Digits-only haystack for figure matching. */
  numerals: string;
  available: boolean;
  note: string;
}

/**
 * Check every claim in a briefing against the sources it cites.
 *
 * Runs entirely locally: the embedder is the MiniLM already in this codebase,
 * so this adds no API cost and no third-party sees the briefing. What it does
 * cost is one fetch per cited source and a few hundred embeddings, which is why
 * it is an explicit action rather than something that happens on every save.
 */
export async function verifyClaims(input: {
  markdown: string;
  citations: Citation[];
}): Promise<ClaimReport> {
  const embedder = getEmbedder();
  const thresholds = thresholdsFor(embedder.id);
  const empty: ClaimReport = {
    verdicts: [],
    supportScore: 0,
    supported: 0,
    weak: 0,
    unsupported: 0,
    unavailable: 0,
    uncited: 0,
    contradicted: 0,
    thresholds,
    model: embedder.id,
    checkedAt: Date.now(),
  };

  // Refused rather than approximated. `thresholds: null` reaches the UI as
  // "this deployment cannot judge claims", which is true, instead of a page of
  // confident verdicts drawn from a scale nobody has calibrated.
  if (!thresholds) return empty;

  const sentences = segment(input.markdown);
  const byId = new Map(input.citations.map((c) => [c.id, c]));

  // Only two kinds of sentence are worth a verdict: one that cites something,
  // and one that asserts a figure without citing anything. Ordinary uncited
  // prose — "the opportunity is real" — is an opinion, and reporting it as
  // unsupported would bury the real findings under noise.
  const claims = sentences
    .filter((s) => s.citationIds.some((id) => byId.has(id)) || extractFigures(s.clean).length > 0)
    .slice(0, MAX_CLAIMS);

  if (claims.length === 0) return empty;

  // Fetch and embed each cited source exactly once, however many claims use it.
  const cited = [...new Set(claims.flatMap((c) => c.citationIds))].filter((id) => byId.has(id));
  const sources = await loadSources(cited, byId, embedder);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const claimVectors = await embedder.embedAll(claims.map((c) => c.clean));

  const verdicts = claims.map((claim, i) =>
    judge(claim, i, claimVectors[i], sourceById, thresholds),
  );

  const count = (k: SupportKind) => verdicts.filter((v) => v.kind === k).length;
  const supported = count("supported");
  // Claims whose sources could not be read are excluded from the denominator:
  // a paywall is not evidence that a claim is wrong, and counting it as one
  // would make the score a measure of the internet rather than of the briefing.
  const checkable = verdicts.filter((v) => v.kind !== "unavailable").length;

  return {
    verdicts,
    supportScore: checkable === 0 ? 0 : Number((supported / checkable).toFixed(2)),
    supported,
    weak: count("weak"),
    unsupported: count("unsupported"),
    unavailable: count("unavailable"),
    uncited: count("uncited"),
    contradicted: count("contradicted"),
    thresholds,
    model: embedder.id,
    checkedAt: Date.now(),
  };
}

async function loadSources(
  ids: number[],
  byId: Map<number, Citation>,
  embedder: ReturnType<typeof getEmbedder>,
): Promise<SourceText[]> {
  const fetched = await mapLimit(ids, CONCURRENCY, async (id) => {
    const citation = byId.get(id)!;
    const page = await fetchPageText(citation.url);
    return { id, page };
  });

  // The chunk budget is shared across sources rather than given to each, so a
  // briefing citing thirty pages costs the same as one citing three.
  const perSource = Math.max(10, Math.floor(MAX_CHUNKS / Math.max(1, fetched.length)));

  const out: SourceText[] = [];
  for (const { id, page } of fetched) {
    const text = page.text ? normaliseText(page.text) : "";
    const chunks = text ? chunkWords(text, perSource) : [];
    out.push({
      id,
      chunks: chunks.map((c) => c.text),
      // Embedded here rather than in one big batch so peak memory stays flat.
      vectors: chunks.length ? await embedder.embedAll(chunks.map((c) => c.text)) : [],
      numerals: text.replace(/,/g, ""),
      available: chunks.length > 0,
      note: page.error ?? "",
    });
  }
  return out;
}

function judge(
  claim: Sentence,
  index: number,
  vector: number[],
  sources: Map<number, SourceText>,
  thresholds: Thresholds,
): ClaimVerdict {
  const base = { index, text: claim.text, citationIds: claim.citationIds };
  const figures = extractFigures(claim.clean);
  const figureDisplays = figures.map((f) => f.display);
  const cited = claim.citationIds.map((id) => sources.get(id)).filter(Boolean) as SourceText[];

  if (cited.length === 0) {
    return {
      ...base,
      kind: "uncited",
      score: null,
      sourceId: null,
      passage: null,
      unmatchedFigures: figureDisplays,
      note: "States a figure but cites no source.",
    };
  }

  const readable = cited.filter((s) => s.available);
  if (readable.length === 0) {
    return {
      ...base,
      kind: "unavailable",
      score: null,
      sourceId: null,
      passage: null,
      unmatchedFigures: [],
      note: cited[0].note || "The cited sources could not be read.",
    };
  }

  let best = { score: -1, sourceId: null as number | null, passage: null as string | null };
  for (const source of readable) {
    for (let i = 0; i < source.vectors.length; i++) {
      const score = cosine(vector, source.vectors[i]);
      if (score > best.score) best = { score, sourceId: source.id, passage: source.chunks[i] };
    }
  }

  const haystack = readable.map((s) => s.numerals).join(" ");
  const unmatched = figures.filter((f) => !figurePresent(f.core, haystack)).map((f) => f.display);
  const score = Number(best.score.toFixed(3));

  // ---------------------------------------------------------------------
  // The literal guards, applied before the similarity bands.
  //
  // Calibration against the labelled set produced the finding that shapes this
  // whole function: passages that *contradict* a claim score higher on average
  // (0.554) than passages that genuinely paraphrase it (0.531). An embedding
  // encodes subject matter, and a denial is about exactly the same subject
  // matter as the assertion it denies.
  //
  // So similarity alone can never separate them, at any threshold, and the two
  // cases that can be checked literally are checked literally instead.
  // ---------------------------------------------------------------------

  // 1. An explicit denial in the passage that most resembles the claim.
  const refutation = best.passage ? refutationIn(best.passage, claim.clean) : null;
  if (refutation && score >= thresholds.weak) {
    return {
      ...base,
      kind: "contradicted",
      score,
      sourceId: best.sourceId,
      passage: best.passage,
      unmatchedFigures: unmatched,
      note: `Source [${best.sourceId}] addresses this and says "${refutation}".`,
    };
  }

  // 2. A number the source does not contain. A claim can read as well-supported
  // and still assert a figure that appears nowhere in it — the fabricated
  // statistic this check exists for — so an unmatched figure caps the verdict
  // no matter how well the prose matched.
  if (unmatched.length > 0 && score >= thresholds.weak) {
    return {
      ...base,
      kind: "weak",
      score,
      sourceId: best.sourceId,
      passage: best.passage,
      unmatchedFigures: unmatched,
      note: `The wording is supported, but ${unmatched.join(", ")} appears nowhere in the cited source.`,
    };
  }

  const kind: SupportKind =
    score >= thresholds.supported ? "supported" : score >= thresholds.weak ? "weak" : "unsupported";

  return {
    ...base,
    kind,
    score,
    sourceId: best.sourceId,
    // Nothing in the source supports an unsupported claim, so there is no
    // evidence to show. Printing the closest passage anyway would put text
    // beside the claim that a reader would naturally take as backing it — the
    // precise illusion this whole check exists to dispel.
    passage: kind === "unsupported" ? null : best.passage,
    unmatchedFigures: unmatched,
    note:
      kind === "supported"
        ? `A passage in source [${best.sourceId}] states this.`
        : kind === "weak"
          ? `Source [${best.sourceId}] is related but does not plainly state this.`
          : "No passage in the cited sources resembles this claim.",
  };
}
