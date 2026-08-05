import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";
import { instrumentAI } from "@/lib/health/instrument";

export type { AIProvider, ChatMessage, GenerateOptions } from "./types";

let cached: AIProvider | null = null;

/**
 * Select the active provider from the environment. Preference order:
 *   OPENAI_API_KEY → OpenAI, else ANTHROPIC_API_KEY → Anthropic, else Mock.
 * Force one with AI_PROVIDER=openai|anthropic|mock.
 */
export function getProvider(): AIProvider {
  if (cached) return cached;

  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (forced === "mock") cached = new MockProvider();
  else if (forced === "openai" && openaiKey) cached = new OpenAIProvider(openaiKey);
  else if (forced === "anthropic" && anthropicKey) cached = new AnthropicProvider(anthropicKey);
  else if (openaiKey) cached = new OpenAIProvider(openaiKey);
  else if (anthropicKey) cached = new AnthropicProvider(anthropicKey);
  else cached = new MockProvider();

  // Wrapped once, at the seam, so every provider reports its own health and a
  // future one is covered without anyone remembering to instrument it.
  cached = instrumentAI(cached);
  return cached;
}
