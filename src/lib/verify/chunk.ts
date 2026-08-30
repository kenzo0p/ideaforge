// ---------------------------------------------------------------------------
// Cutting a source page into passages that can be matched against a claim.
//
// Why not embed the whole page: an embedding is a fixed-size summary, so a
// 4,000-word article and the one sentence in it that supports a claim collapse
// to the same 384 numbers. The signal is drowned. Matching has to happen at
// roughly the granularity of the claim, which means passages.
//
// Why the windows overlap: a claim's supporting sentence lands wherever it
// lands, and a hard split every 60 words will sooner or later cut one in half.
// Both halves then score poorly and a well-supported claim is reported as
// unsupported — a false accusation, which is the expensive direction of error
// here. A 50% stride guarantees every span of `size` consecutive words appears
// intact in some window.
// ---------------------------------------------------------------------------

export interface Chunk {
  text: string;
  /** Word offset into the source, for ordering and for explaining a match. */
  offset: number;
}

const SIZE = 60;
const STRIDE = 30;

/**
 * Collapse the whitespace a stripped HTML page is full of.
 *
 * Tag removal leaves long runs of blank lines and non-breaking spaces where the
 * markup used to be. Left in, they consume window slots that should hold words.
 */
export function normaliseText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Overlapping word windows over a page.
 *
 * `limit` bounds a single source: some pages are books, and embedding a book to
 * check one sentence is a cost with no matching benefit. The cap is applied to
 * the number of windows rather than to the text so that a long page is sampled
 * from its beginning, which is where a cited claim almost always lives.
 */
export function chunkWords(text: string, limit = 80): Chunk[] {
  const words = normaliseText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const out: Chunk[] = [];
  for (let i = 0; i < words.length && out.length < limit; i += STRIDE) {
    const slice = words.slice(i, i + SIZE);
    // A trailing window shorter than a stride is already contained in the
    // previous one, so emitting it would be duplicate work for no new coverage.
    if (i > 0 && slice.length <= STRIDE) break;
    out.push({ text: slice.join(" "), offset: i });
  }
  return out;
}
