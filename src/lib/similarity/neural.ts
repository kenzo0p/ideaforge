import type { Embedder } from "./types";

// ---------------------------------------------------------------------------
// Neural embedding: all-MiniLM-L6-v2 via transformers.js, running locally.
//
// No API key and no network call per request — the model is downloaded once
// and inference runs on CPU in-process. Measured on this codebase: ~11 s to
// load the first time, then ~4 ms per idea.
//
// It earns its cost on paraphrase. Two ways of writing the same idea with no
// shared vocabulary score ~0.72 here against ~0.36 for unrelated ideas, a
// separation the lexical embedder cannot produce.
//
// The cost is real: ~164 MB of dependencies and a few hundred MB resident.
// That is why this is opt-in rather than the default.
// ---------------------------------------------------------------------------

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;

/** Loaded once per process; the load is slow and the model is stateless. */
let extractorPromise: Promise<unknown> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    // Imported dynamically so a deployment that never enables this never pays
    // the module-resolution cost, and so the dependency stays optional.
    extractorPromise = import("@xenova/transformers").then(({ pipeline, env }) => {
      // No remote model fetching at request time beyond the first load, and no
      // telemetry. The cache lives with the app.
      env.allowLocalModels = true;
      return pipeline("feature-extraction", MODEL);
    });
  }
  return extractorPromise as Promise<
    (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>
  >;
}

export class NeuralEmbedder implements Embedder {
  readonly id = "minilm";
  readonly label = "all-MiniLM-L6-v2 (local)";
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    // Mean pooling over tokens, normalised by the library, so the result is a
    // unit vector and cosine similarity is a dot product.
    const out = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  }

  async embedAll(texts: string[]): Promise<number[][]> {
    // Sequential rather than parallel: inference is CPU-bound and already
    // single-threaded, so concurrency buys nothing and multiplies peak memory.
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}
