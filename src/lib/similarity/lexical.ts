import { normalise, type Embedder } from "./types";

// ---------------------------------------------------------------------------
// Lexical embedding: hashed TF-IDF over word and character n-grams.
//
// The default, because it needs no model, no download and no meaningful
// memory — a deployment with 512 MB of RAM can run it.
//
// Two design choices worth stating:
//
//   • Character 4-grams alongside words. Project ideas are short and full of
//     morphological variation ("irrigation" / "irrigate" / "irrigating"), which
//     word-only matching treats as three unrelated tokens. Character n-grams
//     recover most of that without a stemmer.
//   • The hashing trick rather than a learned vocabulary. A vocabulary would
//     have to be rebuilt and every stored vector recomputed each time a new
//     idea introduced a word. Hashing into a fixed space keeps vectors
//     comparable forever, at the cost of occasional collisions that are
//     harmless at this dimensionality.
//
// It cannot see through a full paraphrase. That is the honest limit of any
// lexical method, and it is why the neural embedder exists.
// ---------------------------------------------------------------------------

const DIMENSIONS = 512;

/** Words that carry no signal about what an idea is about. */
const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "by", "with", "from", "that", "this", "it", "is", "are", "was", "be", "been",
  "as", "into", "using", "use", "uses", "used", "via", "their", "them", "they",
  "we", "our", "you", "your", "can", "will", "would", "should", "app", "system",
  "platform", "tool", "solution", "website", "web", "build", "building", "make",
  "create", "help", "helps", "helping", "based", "which", "who", "when", "where",
]);

/** FNV-1a — small, fast, and good enough to spread tokens across the space. */
function hash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIMENSIONS;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Sliding character n-grams over the whitespace-collapsed string. */
function charNgrams(text: string, n = 4): string[] {
  const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out: string[] = [];
  for (let i = 0; i + n <= clean.length; i++) {
    const gram = clean.slice(i, i + n);
    if (!gram.includes("  ")) out.push(gram);
  }
  return out;
}

export class LexicalEmbedder implements Embedder {
  readonly id = "lexical";
  readonly label = "TF-IDF (lexical)";
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(DIMENSIONS).fill(0);
    const tokens = words(text);
    const grams = charNgrams(text);

    // Sub-linear term frequency: a word repeated five times is more relevant
    // than one used once, but not five times more. Standard log-scaled tf,
    // which matters here because idea text is short enough that one repeated
    // word would otherwise dominate the vector.
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [token, n] of counts) {
      vec[hash(token)] += 1 + Math.log(n);
    }

    // Character n-grams are weighted lower: there are far more of them, and
    // left unweighted they would drown out the words entirely.
    const gramCounts = new Map<string, number>();
    for (const g of grams) gramCounts.set(g, (gramCounts.get(g) ?? 0) + 1);
    for (const [gram, n] of gramCounts) {
      vec[hash(`#${gram}`)] += 0.35 * (1 + Math.log(n));
    }

    return normalise(vec);
  }

  async embedAll(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
