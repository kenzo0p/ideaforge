// ---------------------------------------------------------------------------
// Text similarity, behind the same provider seam as AI, search, email and
// billing.
//
// Two implementations with genuinely different trade-offs:
//
//   • lexical  — TF-IDF over word and character n-grams. No dependencies, no
//                model download, negligible memory. Misses paraphrases that
//                share no words ("lab matcher" vs "connecting students to
//                professors").
//   • neural   — all-MiniLM-L6-v2 running locally via transformers.js. Handles
//                paraphrase properly, at the cost of ~164 MB of dependencies
//                and a few hundred MB of resident memory, which a small
//                instance may not have.
//
// The seam exists because that second cost is a deployment decision, not an
// algorithmic one, and it should be changeable without touching feature code.
// ---------------------------------------------------------------------------

export interface Embedder {
  readonly id: string;
  readonly label: string;
  /** Vector length. Stored alongside each vector so a model change is detectable. */
  readonly dimensions: number;
  /** Unit-normalised vector, so cosine similarity is a plain dot product. */
  embed(text: string): Promise<number[]>;
  /** Batch form; implementations may optimise, the default just maps. */
  embedAll(texts: string[]): Promise<number[][]>;
}

/**
 * Cosine similarity of two unit vectors, i.e. their dot product.
 *
 * Every embedder here normalises before returning, so skipping the magnitude
 * division is correct rather than an approximation. Guarded on length because
 * comparing vectors from two different models is meaningless, and silently
 * returning a plausible number would hide a model change.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Normalise in place to unit length. Returns the same array for chaining. */
export function normalise(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
