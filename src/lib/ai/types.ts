// ---------------------------------------------------------------------------
// AI provider abstraction
//
// Everything in the app talks to `AIProvider`, never to a concrete SDK. This is
// what lets us swap the underlying model — or the real iNSIGHTS Layer 2 API —
// without touching feature code. A Mock provider implements the same interface
// so the whole product runs end-to-end with zero API keys during development.
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  /** 0 = deterministic, 1 = creative. Defaults per-provider. */
  temperature?: number;
  maxTokens?: number;
  /** Hint that the model should return strict JSON. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface AIProvider {
  /** Stable id, e.g. "openai", "anthropic", "mock". */
  readonly id: string;
  /** Human-friendly label for the UI badge. */
  readonly label: string;
  /** True when responses are synthesized locally (no external model). */
  readonly isMock: boolean;

  /** Stream the completion token-by-token. */
  streamText(options: GenerateOptions): AsyncIterable<string>;

  /** Convenience: collect the full completion into one string. */
  generateText(options: GenerateOptions): Promise<string>;
}
