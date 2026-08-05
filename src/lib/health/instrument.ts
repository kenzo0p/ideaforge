import { recordFailure, recordSuccess } from "./status";
import type { AIProvider, GenerateOptions } from "@/lib/ai/types";
import type { SearchProvider, SearchOptions, SearchResult } from "@/lib/search/types";

// ---------------------------------------------------------------------------
// Health instrumentation, applied at the provider seam.
//
// Wrapping the provider rather than editing each implementation means the
// Anthropic, OpenAI, Tavily and Mock classes stay ignorant of health tracking,
// and — the part that actually matters — a provider added next year is
// instrumented the moment it is returned from the factory, without anyone
// remembering to add a call.
// ---------------------------------------------------------------------------

/**
 * A user pressing stop is not a provider failure.
 *
 * Without this every cancelled generation would count toward the degradation
 * threshold, and a page full of impatient users would look identical to an
 * outage.
 */
function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message))) ||
    (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError")
  );
}

export function instrumentAI(provider: AIProvider): AIProvider {
  // The mock never touches the network, so recording its health would report a
  // permanently perfect dependency that tells you nothing.
  if (provider.isMock) return provider;

  return {
    id: provider.id,
    label: provider.label,
    isMock: provider.isMock,

    async *streamText(options: GenerateOptions): AsyncIterable<string> {
      let yielded = false;
      try {
        for await (const chunk of provider.streamText(options)) {
          // Success is recorded on the *first token*, not at the end of the
          // stream. A generation that starts fine and is cancelled halfway
          // proves the provider is answering, which is the question here.
          if (!yielded) {
            yielded = true;
            recordSuccess("ai");
          }
          yield chunk;
        }
        if (!yielded) recordSuccess("ai");
      } catch (err) {
        if (!isAbort(err)) recordFailure("ai", err);
        throw err;
      }
    },

    async generateText(options: GenerateOptions): Promise<string> {
      try {
        const text = await provider.generateText(options);
        recordSuccess("ai");
        return text;
      } catch (err) {
        if (!isAbort(err)) recordFailure("ai", err);
        throw err;
      }
    },
  };
}

export function instrumentSearch(provider: SearchProvider): SearchProvider {
  if (provider.isMock) return provider;

  return {
    id: provider.id,
    label: provider.label,
    isMock: provider.isMock,

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      try {
        const results = await provider.search(query, options);
        recordSuccess("search");
        return results;
      } catch (err) {
        if (!isAbort(err)) recordFailure("search", err);
        throw err;
      }
    },
  };
}
