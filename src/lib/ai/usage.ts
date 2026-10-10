import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Counting what a run actually cost.
//
// Every model call reports how many tokens it read and wrote, and until now the
// app threw that number away. It is the one figure that turns "this took a
// while" into something a user can reason about — how much of their quota a run
// spent, why one idea costs three times another, and whether a prompt edit made
// things cheaper or just different.
//
// The hard part is attribution, not measurement. A single validation is one
// model call; a DeepSearch is several, spread across helper functions that have
// no idea which project or which user they are serving. Threading a counter
// through every one of them would put bookkeeping in the signature of every
// function in the pipeline.
//
// So the count travels in the async context instead. A route opens a scope,
// everything underneath it records into that scope no matter how deep, and the
// route reads the total when the work finishes. Providers are the only things
// that call `record`, which means a provider added later is counted the moment
// it reports usage, and one that reports nothing is visibly absent rather than
// silently zero.
// ---------------------------------------------------------------------------

export {
  EMPTY_USAGE,
  USAGE_MARKER,
  decodeUsage,
  encodeUsage,
  estimateTokens,
  totalTokens,
  type TokenUsage,
} from "./usage-shared";

import { EMPTY_USAGE, type TokenUsage } from "./usage-shared";

interface Scope {
  usage: TokenUsage;
}

const store = new AsyncLocalStorage<Scope>();

/**
 * Add one model call's usage to the surrounding scope.
 *
 * Silently does nothing outside a scope. Background work — the watch runner,
 * the reminder scheduler — calls the same providers without anyone waiting on a
 * figure, and making those paths fail for want of a counter would be a poor
 * trade for a number nobody reads.
 */
export function record(call: {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  provider: string;
  model: string;
}): void {
  const scope = store.getStore();
  if (!scope) return;
  const u = scope.usage;
  u.inputTokens += Math.max(0, Math.round(call.inputTokens));
  u.outputTokens += Math.max(0, Math.round(call.outputTokens));
  u.calls += 1;
  // One estimated call taints the total, because the total is then partly a
  // guess and saying otherwise would overstate what we know.
  u.estimated = u.estimated || call.estimated;
  u.provider = call.provider;
  u.model = call.model;
}

/** The running total inside the current scope, or null outside one. */
export function current(): TokenUsage | null {
  const scope = store.getStore();
  return scope ? { ...scope.usage } : null;
}

/**
 * Run `fn` with a fresh counter and return what it produced alongside the total.
 *
 * Works for streaming too: an async generator consumed inside the callback
 * stays in this context, so tokens counted after the first chunk still land
 * here.
 */
export async function withUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: TokenUsage }> {
  const scope: Scope = { usage: { ...EMPTY_USAGE } };
  const result = await store.run(scope, fn);
  return { result, usage: scope.usage };
}

/**
 * Wrap a stream so the caller can read the total once it finishes.
 *
 * The scope is opened here rather than around the `for await`, because the
 * consumer of a stream is often in a different function from its producer — in
 * a route handler, the ReadableStream callback runs after the handler has
 * already returned.
 */
export function streamWithUsage<T>(
  make: () => AsyncIterable<T>,
): { stream: AsyncIterable<T>; usage: () => TokenUsage } {
  const scope: Scope = { usage: { ...EMPTY_USAGE } };
  async function* wrapped() {
    const iterator = store.run(scope, () => make()[Symbol.asyncIterator]());
    while (true) {
      // Each pull re-enters the scope, so usage reported mid-stream — which is
      // when Anthropic sends its output count — is still attributed here.
      const next = await store.run(scope, () => iterator.next());
      if (next.done) return;
      yield next.value;
    }
  }
  return { stream: wrapped(), usage: () => ({ ...scope.usage }) };
}

