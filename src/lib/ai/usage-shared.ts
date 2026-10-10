// ---------------------------------------------------------------------------
// The parts of token accounting that both sides need.
//
// Split out from `usage.ts` because that module owns an AsyncLocalStorage, and
// `node:async_hooks` cannot be bundled for the browser. The client needs the
// shape of a total and the separator that marks one at the end of a stream; it
// has no business with the scope that produces them.
//
// Anything here must stay free of Node built-ins. If something new needs one,
// it belongs on the other side of this line.
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Model calls that contributed. A DeepSearch is several; a validation is one. */
  calls: number;
  /**
   * True when any part of this total was derived from text length rather than
   * reported by the provider.
   *
   * Kept because an estimate and a measurement should never be shown the same
   * way. The offline demo provider has no real tokens to report, and a made-up
   * number presented as a measured one is the kind of small dishonesty this
   * codebase spends its time catching elsewhere.
   */
  estimated: boolean;
  /** Which provider and model produced the bulk of it, for display. */
  provider: string;
  model: string;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  estimated: false,
  provider: "",
  model: "",
};

export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens;
}

/**
 * Rough token count for text, when nothing better is available.
 *
 * Four characters per token is the usual English approximation, and it is close
 * enough for a demo-mode figure that is labelled as an approximation. It is
 * never used when a provider reports a real number.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/**
 * The marker that carries a total at the end of a streamed response.
 *
 * A stream's headers are already sent by the time the token count is known, so
 * the figure has to travel in the body. U+001F is the ASCII unit separator: it
 * has no visual form, never appears in prose or markdown, and gives the client
 * an unambiguous point to cut at.
 */
export const USAGE_MARKER = "\u001F";

export function encodeUsage(u: TokenUsage): string {
  return USAGE_MARKER + JSON.stringify(u);
}

/** Split a streamed body into its text and the usage trailer, if present. */
export function decodeUsage(body: string): { text: string; usage: TokenUsage | null } {
  const at = body.lastIndexOf(USAGE_MARKER);
  if (at === -1) return { text: body, usage: null };
  try {
    return { text: body.slice(0, at), usage: JSON.parse(body.slice(at + 1)) as TokenUsage };
  } catch {
    // A truncated trailer is not worth losing the answer over.
    return { text: body.slice(0, at), usage: null };
  }
}
