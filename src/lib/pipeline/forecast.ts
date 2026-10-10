import { estimateTokens } from "@/lib/ai/usage-shared";
import type {
  PromptForecast,
  PromptRecommendation,
  StructuredPrompt,
} from "./types";

// ---------------------------------------------------------------------------
// What a prompt will cost, before anyone spends it.
//
// Every other token figure in this codebase is a measurement handed back by a
// provider after the fact. This one is a forecast, and the distinction is the
// whole reason this file is separate from `lib/ai/usage`: nothing here has been
// observed, and a prediction shown in the same shape as a measurement would
// quietly borrow its authority.
//
// So the forecast is a range, its method is stated wherever it appears, and the
// recommendations built on it are computed arithmetic rather than model output.
// The model drafts the prompts; the code does the counting and the advice that
// follows from counting. A model asked "how many tokens is this?" will answer
// confidently and be wrong, which is precisely the failure this product exists
// to refuse.
// ---------------------------------------------------------------------------

/**
 * How wide the output range is, either side of the expected size.
 *
 * A single number would be a false point estimate: answer length varies with
 * the model, the temperature and how much the source material supports. Forty
 * per cent is wide enough to be honest and narrow enough to be useful.
 */
const SPREAD = 0.4;

/**
 * Expected answer size for a prompt, in tokens.
 *
 * Scales with the number of sections the prompt asks for, because that is what
 * actually drives length — a prompt demanding six headed sections produces a
 * longer answer than one asking for a paragraph, whatever its own length.
 */
function expectedOutput(prompt: string, sections: number): number {
  const base = 320;
  const perSection = 180;
  // A long prompt implies a detailed answer, but only weakly; the section count
  // dominates and this is a nudge, not a driver.
  const lengthNudge = Math.min(400, estimateTokens(prompt) * 0.25);
  return Math.round(base + sections * perSection + lengthNudge);
}

export function forecastPrompt(prompt: string, sections: string[]): PromptForecast {
  const promptTokens = estimateTokens(prompt);
  const mid = expectedOutput(prompt, sections.length);
  return {
    promptTokens,
    outputLow: Math.round(mid * (1 - SPREAD)),
    outputHigh: Math.round(mid * (1 + SPREAD)),
    totalMid: promptTokens + mid,
  };
}

export function sumForecasts(prompts: StructuredPrompt[]): PromptForecast {
  return prompts.reduce<PromptForecast>(
    (acc, p) => ({
      promptTokens: acc.promptTokens + p.forecast.promptTokens,
      outputLow: acc.outputLow + p.forecast.outputLow,
      outputHigh: acc.outputHigh + p.forecast.outputHigh,
      totalMid: acc.totalMid + p.forecast.totalMid,
    }),
    { promptTokens: 0, outputLow: 0, outputHigh: 0, totalMid: 0 },
  );
}

/** Words that carry no information about what an idea is. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "that",
  "this", "some", "kind", "sort", "thing", "stuff", "better", "good", "new",
  "app", "application", "system", "platform", "tool", "solution", "website",
  "build", "make", "create", "develop", "using", "use", "based", "help",
  "manage", "smart", "ai", "ml",
]);

/** Does the idea name who it is for? */
const AUDIENCE = /\b(student|farmer|teacher|patient|nurse|doctor|driver|shopkeeper|merchant|seller|buyer|parent|child|worker|staff|resident|user|citizen|customer|hostel|college|school|hospital|clinic|factory|warehouse|municipal|department)/i;

/** Does it name a measurable outcome? */
const OUTCOME = /\b(reduce|cut|increase|save|lower|raise|speed|shorten|prevent|detect|predict|forecast|match|rank|verify|track|%|percent|hours?|minutes?|rupees?|cost|waste|time|accuracy)/i;

function distinctWords(idea: string): string[] {
  return [
    ...new Set(
      idea.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean),
    ),
  ].filter((w) => w.length > 2 && !FILLER.has(w));
}

const fmt = (n: number) => n.toLocaleString();

/**
 * What to do next, derived from the set rather than asked of the model.
 *
 * Each of these is a fact about the text or the arithmetic. That matters:
 * advice a model invents is indistinguishable from advice it remembered from
 * somewhere, and this is the one part of the feature that can be checked by
 * reading the input.
 */
export function recommend(input: {
  idea: string;
  prompts: StructuredPrompt[];
  total: PromptForecast;
}): PromptRecommendation[] {
  const out: PromptRecommendation[] = [];
  const { idea, prompts, total } = input;

  // Which to run first: the cheapest prompt that still asks for real structure.
  // Starting with the most expensive one is how people spend their whole budget
  // discovering the idea needed rewording.
  const ordered = [...prompts].sort((a, b) => a.forecast.totalMid - b.forecast.totalMid);
  const first = ordered.find((p) => p.expectSections.length >= 3) ?? ordered[0];
  if (first) {
    out.push({
      kind: "pick",
      title: `Start with “${first.angle}”`,
      detail:
        `It is the cheapest of the ${prompts.length} at about ${fmt(first.forecast.totalMid)} tokens ` +
        `and still asks for ${first.expectSections.length} sections. If the answer shows you ` +
        `misframed the idea, you will have learned that before spending the rest.`,
    });
  }

  // Sharpening: both of these are facts about the sentence they typed.
  const words = distinctWords(idea);
  if (words.length < 4) {
    out.push({
      kind: "sharpen",
      title: "The idea is very short",
      detail:
        `It carries ${words.length} distinctive ${words.length === 1 ? "word" : "words"} once ` +
        `filler is removed, so the prompts below had to guess at the specifics. Naming the ` +
        `setting and the outcome would narrow all of them at once.`,
    });
  }
  if (!AUDIENCE.test(idea)) {
    out.push({
      kind: "sharpen",
      title: "No one is named",
      detail:
        "The idea does not say who has this problem. Adding the specific group — who they " +
        "are and where — is the single change that most improves every prompt here, because " +
        "it is what the research will be scoped to.",
    });
  }
  if (!OUTCOME.test(idea)) {
    out.push({
      kind: "sharpen",
      title: "No outcome to measure",
      detail:
        "Nothing in the idea says what would change if it worked. Without that, an answer " +
        "can be agreeable without being useful, since there is nothing for it to be wrong about.",
    });
  }

  // The arithmetic.
  out.push({
    kind: "cost",
    title: `Running all ${prompts.length} costs about ${fmt(total.totalMid)} tokens`,
    detail:
      `${fmt(total.promptTokens)} to send, and roughly ${fmt(total.outputLow)}–${fmt(total.outputHigh)} ` +
      `back. These are forecasts from text length, not measurements — expect to be out by ` +
      `a fifth either way, and treat the comparison between prompts as firmer than the totals.`,
  });

  if (total.totalMid > 12000) {
    out.push({
      kind: "warn",
      title: "That is a large batch",
      detail:
        "Run one, read it, then decide whether the others still ask the right thing. Prompts " +
        "written before you have seen any answer are usually the ones worth revising.",
    });
  }

  return out;
}
