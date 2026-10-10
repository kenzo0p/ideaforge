// ---------------------------------------------------------------------------
// Does the passage contradict the claim?
//
// The calibration in claim-pairs.json produced the finding this file answers:
// passages that contradict a claim score *higher* on cosine similarity than
// passages that genuinely support it (0.554 against 0.531), because an
// embedding encodes subject matter and a denial is about the same subject as
// the assertion it denies. No similarity threshold separates them.
//
// The first answer was a list of refutation phrases — "found no significant",
// "little difference" — scoped to the claim's own vocabulary. High precision,
// low recall, and honest about it: a passage arguing the opposite without any
// of those phrases sailed through.
//
// This is the second answer: a natural-language-inference cross-encoder, run
// locally, that reads the passage and the claim together and scores whether one
// contradicts the other.
//
// USED FOR CONTRADICTION ONLY, and that restraint is measured rather than
// cautious. Strict NLI treats a claim as `neutral` whenever the passage does
// not establish its full scope — "payback runs to eleven years" against
// "payback in India is under six years" is neutral to an NLI model, because the
// passage never said India. Real briefings carry that context in the
// surrounding prose, so entailment scores here are pessimistic and the
// embedder remains the better judge of support. Contradiction is the direction
// where the model is confident and right:
//
//     contradictory pairs   mean 0.664, four of six above 0.98
//     genuine support       zero above 0.80 across 22 pairs
//
// So it runs at 0.80, where it caught the one contradiction the phrase list
// could not, and misclassified nothing.
// ---------------------------------------------------------------------------

export interface Entailment {
  contradiction: number;
  entailment: number;
  neutral: number;
}

export interface Entailer {
  readonly id: string;
  readonly label: string;
  /** Null when no judgement could be made — a missing model is not a verdict. */
  score(passage: string, claim: string): Promise<Entailment | null>;
}

/**
 * Above this, the passage is taken to contradict the claim.
 *
 * Chosen from the sweep in `npm run eval:claims`, at the lowest point where no
 * genuinely supported pair is flagged. Calling a real source a contradiction is
 * the expensive error: it tells a student their evidence refutes them when it
 * does not, which is worse than missing a contradiction they might still catch
 * by reading.
 */
export const CONTRADICTION_AT = Number(process.env.CLAIM_CONTRADICTION_AT ?? 0.8);

/** Small enough to run beside the embedder; the smallest that was any good. */
const MODEL = "Xenova/nli-deberta-v3-xsmall";

type Pipeline = {
  tokenizer: (text: string, opts: Record<string, unknown>) => Record<string, unknown>;
  model: (inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>;
  labels: Record<string, string>;
};

let pipelinePromise: Promise<Pipeline | null> | null = null;

/**
 * Load once per process, and never throw.
 *
 * The model is ~70 MB and takes the better part of a minute to fetch the first
 * time. A deployment that cannot afford either should lose the contradiction
 * check and keep everything else, rather than lose the claim check entirely —
 * so a failure here resolves to null and is reported as "not available", not as
 * "no contradictions found".
 */
async function getPipeline(): Promise<Pipeline | null> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(
          "@xenova/transformers"
        );
        env.allowLocalModels = true;
        const [tokenizer, model] = await Promise.all([
          AutoTokenizer.from_pretrained(MODEL),
          AutoModelForSequenceClassification.from_pretrained(MODEL),
        ]);
        return {
          tokenizer: tokenizer as unknown as Pipeline["tokenizer"],
          model: model as unknown as Pipeline["model"],
          labels: (model as unknown as { config: { id2label: Record<string, string> } }).config.id2label,
        };
      } catch (err) {
        console.warn(
          "Entailment model unavailable; contradiction detection falls back to the phrase list:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })();
  }
  return pipelinePromise;
}

function softmax(logits: ArrayLike<number>): number[] {
  const values = Array.from(logits);
  const max = Math.max(...values);
  const exp = values.map((x) => Math.exp(x - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((x) => x / sum);
}

class NliEntailer implements Entailer {
  readonly id = "nli-deberta-v3-xsmall";
  readonly label = "DeBERTa-v3-xsmall NLI (local)";

  async score(passage: string, claim: string): Promise<Entailment | null> {
    const pipeline = await getPipeline();
    if (!pipeline) return null;
    try {
      // The passage is the premise and the claim the hypothesis, which is the
      // direction the question is actually asked in: does what the source says
      // support, contradict, or fail to settle what the briefing claims?
      const inputs = pipeline.tokenizer(passage, { text_pair: claim, truncation: true });
      const out = await pipeline.model(inputs);
      const probs = softmax(out.logits.data);

      const byLabel: Entailment = { contradiction: 0, entailment: 0, neutral: 0 };
      for (const [index, label] of Object.entries(pipeline.labels)) {
        const key = label.toLowerCase();
        if (key === "contradiction" || key === "entailment" || key === "neutral") {
          byLabel[key] = probs[Number(index)] ?? 0;
        }
      }
      return byLabel;
    } catch (err) {
      console.error("Entailment scoring failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
}

/** The null object, for a deployment that has turned entailment off. */
class NoEntailer implements Entailer {
  readonly id = "none";
  readonly label = "disabled";
  async score(): Promise<Entailment | null> {
    return null;
  }
}

let cached: Entailer | null = null;

/**
 * The entailer this deployment uses.
 *
 * Off is a supported answer, not a broken one: the literal guards in claims.ts
 * catch a different set of contradictions and keep working without it. What is
 * not supported is pretending — a disabled entailer returns null rather than
 * zero, so "no contradiction detected" can never be produced by a model that
 * never ran.
 */
export function getEntailer(): Entailer {
  if (cached) return cached;
  cached = process.env.ENTAILMENT_PROVIDER?.toLowerCase() === "none"
    ? new NoEntailer()
    : new NliEntailer();
  return cached;
}

/** Test seam, so the calibration script can compare implementations directly. */
export function makeEntailer(id: "nli" | "none"): Entailer {
  return id === "nli" ? new NliEntailer() : new NoEntailer();
}
