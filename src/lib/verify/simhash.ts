import { shingles } from "./shingle";

// ---------------------------------------------------------------------------
// Recognising the same content wearing a different domain name.
//
// A briefing that cites twelve URLs looks twelve times as well-supported as one
// that cites one. Often it is not. Press releases are reprinted verbatim across
// trade sites; syndicated wire copy appears under a dozen mastheads; an
// aggregator republishes a study's abstract and is then cited alongside the
// study. Counting citations counts republications.
//
// MinHash (shingle.ts) answers "is this the same document as before?" and would
// work here too, but it needs both sketches side by side and is 512 bytes each.
// SimHash answers "is this near-duplicate of that?" with a single 64-bit
// fingerprint, where similar documents land at a small Hamming distance — so
// comparing every source against every other is a handful of XORs rather than
// a set intersection, and the fingerprint is small enough to keep.
//
// The two are not interchangeable. MinHash estimates a similarity; SimHash
// answers a threshold question. Both are here because both questions are asked.
// ---------------------------------------------------------------------------

/**
 * Shingle width for the feature set.
 *
 * Narrower than drift detection's five. A reprint is usually reformatted —
 * different headline, different boilerplate, occasionally a trimmed paragraph —
 * so five-word windows break where four-word ones survive. Three is short
 * enough to see through light editing without matching on vocabulary alone.
 */
const K = 3;

/**
 * A 64-bit fingerprint, as two unsigned 32-bit halves.
 *
 * Not a BigInt. The project targets ES2017, and more usefully this loop runs
 * 64 times per shingle over every cited page — allocating a BigInt per bit test
 * would dominate the cost of a routine that is otherwise pure integer work.
 */
export interface Fingerprint {
  hi: number;
  lo: number;
}

/** Two independent 32-bit hashes, giving the 64 bits SimHash needs. */
function hash64(token: string): Fingerprint {
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x5bf03635;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 16777619);
    b = Math.imul(b ^ c, 2246822519);
    b = (b << 13) | (b >>> 19);
  }
  return { hi: a >>> 0, lo: b >>> 0 };
}

/**
 * A 64-bit SimHash of a document.
 *
 * Each feature votes on each bit: present-and-set pushes that bit towards one,
 * present-and-clear pushes it towards zero, and the sign of the tally decides.
 * Two documents sharing most of their features therefore agree on most bits,
 * which is what makes Hamming distance meaningful here and meaningless for an
 * ordinary hash.
 */
export function simhash(text: string): Fingerprint {
  const features = shingles(text, K);
  if (features.size === 0) return { hi: 0, lo: 0 };

  const votes = new Array<number>(64).fill(0);
  for (const feature of features) {
    const { hi, lo } = hash64(feature);
    for (let bit = 0; bit < 32; bit++) {
      votes[bit] += (lo >>> bit) & 1 ? 1 : -1;
      votes[bit + 32] += (hi >>> bit) & 1 ? 1 : -1;
    }
  }

  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (votes[bit] > 0) lo |= 1 << bit;
    if (votes[bit + 32] > 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

/** Stored as hex, because Mongo has no 64-bit unsigned integer type. */
export function toHex(f: Fingerprint): string {
  return f.hi.toString(16).padStart(8, "0") + f.lo.toString(16).padStart(8, "0");
}

export function fromHex(hex: string): Fingerprint {
  return {
    hi: Number.parseInt(hex.slice(0, 8), 16) >>> 0,
    lo: Number.parseInt(hex.slice(8, 16), 16) >>> 0,
  };
}

/** Hamming weight of a 32-bit word, by the usual bit-twiddle. */
function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0x3f;
}

/** Number of differing bits between two fingerprints. */
export function hamming(a: Fingerprint, b: Fingerprint): number {
  return popcount((a.hi ^ b.hi) >>> 0) + popcount((a.lo ^ b.lo) >>> 0);
}

/**
 * Bits apart, at or below which two documents are the same text republished.
 *
 * Measured, not inherited. The classic figure for 64-bit SimHash is 3, tuned
 * for finding byte-identical duplicates in a web crawl; a press release
 * reprinted under a new headline with another site's furniture is nowhere near
 * that, and 3 would miss almost every real reprint.
 *
 * Over a fixture set of six genuine reprints (verbatim with furniture, headline
 * swapped, intro reworded, tail trimmed, reworded *and* trimmed, and quoted at
 * length inside a longer article) against four independent pieces (same topic
 * by another author, same sector different story, unrelated, generic blurb):
 *
 *     reprints      2 – 15 bits
 *     independent  29 – 38 bits
 *
 * A fourteen-bit gap with nothing in it, so the exact value matters less than
 * which end of the gap it sits at. It sits near the low end deliberately. A
 * false merge tells someone their twelve sources are really eight — understating
 * evidence they actually have, which is the same family of error as calling a
 * live citation dead. A false split merely fails to improve on counting URLs,
 * which is where every other tool already is. Eighteen keeps three bits of
 * margin above the heaviest observed reprint and eleven below the closest
 * independent pair.
 */
export const NEAR_DUPLICATE_BITS = 18;

export function isNearDuplicate(a: Fingerprint, b: Fingerprint): boolean {
  return hamming(a, b) <= NEAR_DUPLICATE_BITS;
}
