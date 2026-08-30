import { LexicalEmbedder } from "./lexical";
import { NeuralEmbedder } from "./neural";
import type { Embedder } from "./types";

export { cosine, normalise, type Embedder } from "./types";

let cached: Embedder | null = null;

/**
 * The embedder this deployment uses. Neural by default, because measurement
 * showed it is the only one that works.
 *
 * Measured over paraphrase / same-domain / unrelated idea pairs:
 *
 *              paraphrase        unrelated        separable?
 *   lexical    0.111 – 0.645     0.093 – 0.279    no — the ranges overlap
 *   neural     0.483 – 0.897     0.029 – 0.363    yes, with margin
 *
 * The lexical ranges cross: a genuine paraphrase can score 0.111 while two
 * unrelated ideas score 0.279, so no threshold separates them. It survives
 * only as an escape hatch for a deployment without the ~300 MB of memory the
 * model needs, and it says so in the log rather than pretending to work.
 */
export function getEmbedder(): Embedder {
  if (cached) return cached;
  if (process.env.EMBEDDING_PROVIDER?.toLowerCase() === "lexical") {
    console.warn(
      "EMBEDDING_PROVIDER=lexical: similar-idea detection is running in a degraded mode " +
        "that cannot separate paraphrases from unrelated ideas. Prefer disabling the " +
        "feature over trusting its output.",
    );
    cached = new LexicalEmbedder();
  } else {
    cached = new NeuralEmbedder();
  }
  return cached;
}

/** Test seam — lets the evaluation script compare implementations directly. */
export function makeEmbedder(id: "lexical" | "neural"): Embedder {
  return id === "neural" ? new NeuralEmbedder() : new LexicalEmbedder();
}
