import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Measuring how much a page has changed since we read it.
//
// Link rot is the easy half. The harder and more common failure is a page that
// stays up, keeps its URL and its title, and quietly loses the paragraph a
// briefing cited — an editor trims a statistic, a news site rewrites a story in
// place, a vendor drops a claim from its own marketing. Nothing about the
// citation looks wrong afterwards.
//
// Detecting that means comparing the page to what it used to be, which sounds
// like it requires keeping a copy of every cited page forever. It does not.
//
//   • A content hash answers "did anything change at all?" in 32 bytes.
//   • A MinHash sketch answers "how much changed?" in ~512 bytes, by estimating
//     the Jaccard similarity of the two documents' shingle sets without either
//     set being present.
//
// So the archive is half a kilobyte per source rather than tens of kilobytes,
// and it never contains anyone's copyrighted text. What is stored is a
// fingerprint, and a fingerprint is all the question needs.
// ---------------------------------------------------------------------------

/**
 * Words per shingle.
 *
 * A shingle is a sliding window of consecutive words, and `k` sets what counts
 * as "the same content". At k=1 this degenerates into comparing vocabulary, so
 * two unrelated articles on one topic look identical. Large k makes the
 * comparison brittle: a single corrected typo breaks every window it touches.
 * Five is the usual compromise and behaves well on prose.
 */
const K = 5;

/** Sketch length. 128 puts the Jaccard estimate within a few points of exact. */
const HASHES = 128;

/** Mersenne prime, so the universal-hash arithmetic stays inside 53-bit floats. */
const P = 2147483647;

/** FNV-1a. Small, fast, and spreads short strings well enough for this. */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % P;
}

/**
 * The permutation coefficients.
 *
 * Generated from a fixed seed rather than randomly, and this is the part that
 * has to be right: a sketch taken in March is compared against one taken in
 * October, in a different process. If the coefficients differed between runs
 * the two sketches would be incomparable, and every page would look completely
 * rewritten every time. Changing this seed invalidates every stored sketch.
 */
const COEFFICIENTS = (() => {
  let state = 0x9e3779b9;
  const next = () => {
    // xorshift32 — deterministic, and adequate for choosing hash coefficients.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % P;
  };
  return Array.from({ length: HASHES }, () => ({
    // `a` must not be zero, or the permutation collapses to a constant.
    a: (next() % (P - 1)) + 1,
    b: next(),
  }));
})();

/** Normalise before fingerprinting, so formatting alone is not a change. */
export function normaliseForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 of the normalised text. Answers "identical or not", exactly. */
export function contentHash(text: string): string {
  return createHash("sha256").update(normaliseForHash(text)).digest("hex");
}

/** The set of k-word shingles in a document. */
export function shingles(text: string, k = K): Set<string> {
  const words = normaliseForHash(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length === 0) return out;
  // A document shorter than one window is its own single shingle, rather than
  // producing nothing and comparing as "empty" against everything.
  if (words.length < k) {
    out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

/**
 * A MinHash sketch of a shingle set.
 *
 * For each of 128 permutations of the hash space, keep the smallest value any
 * shingle takes. The probability that two documents agree at a given position
 * is exactly their Jaccard similarity, so the fraction of matching positions
 * estimates it — which is why two sketches can be compared long after the
 * documents themselves are gone.
 */
export function sketch(set: Set<string>): number[] {
  const out = new Array<number>(HASHES).fill(P);
  if (set.size === 0) return out;
  for (const shingle of set) {
    const h = fnv1a(shingle);
    for (let i = 0; i < HASHES; i++) {
      const v = (COEFFICIENTS[i].a * h + COEFFICIENTS[i].b) % P;
      if (v < out[i]) out[i] = v;
    }
  }
  return out;
}

/** Sketch a document in one step. */
export function sketchOf(text: string): number[] {
  return sketch(shingles(text));
}

/**
 * Estimated Jaccard similarity of the two documents the sketches came from.
 *
 * Returns 0 for mismatched lengths rather than comparing what overlaps: sketches
 * of different sizes come from different versions of this code, and a plausible
 * number computed from incompatible inputs is worse than an obvious zero.
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return Number((same / a.length).toFixed(3));
}

/**
 * Is this passage still present in the document?
 *
 * Not a substring test. The passage was extracted from a page months ago and a
 * single re-flowed sentence would defeat an exact match, reporting a paragraph
 * as deleted when a comma moved. Instead: what share of the passage's own
 * shingles still occur anywhere in the page?
 *
 * `RETAINED` is deliberately low. The claim is "this passage is gone", which is
 * a strong thing to tell someone about their evidence, and half the passage
 * surviving is not gone.
 */
const RETAINED = 0.5;

export function passageSurvives(passage: string, pageShingles: Set<string>): boolean {
  const want = shingles(passage);
  if (want.size === 0) return true;
  let found = 0;
  for (const s of want) if (pageShingles.has(s)) found++;
  return found / want.size >= RETAINED;
}
