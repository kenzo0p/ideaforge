import type { AIProvider, GenerateOptions } from "./types";

// Minimal OpenAI Chat Completions client (SSE streaming) — no SDK dependency so
// the provider stays swappable and the bundle stays small.
export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly isMock = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async *streamText(options: GenerateOptions): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: options.signal,
      body: JSON.stringify({
        model: this.model,
        stream: true,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens,
        messages: options.messages,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI request failed (${res.status}): ${detail}`);
    }

    yield* parseSSE(res.body, (json) => {
      const chunk = json as { choices?: Array<{ delta?: { content?: string } }> };
      return chunk.choices?.[0]?.delta?.content ?? "";
    });
  }

  async generateText(options: GenerateOptions): Promise<string> {
    let out = "";
    for await (const chunk of this.streamText(options)) out += chunk;
    return out;
  }
}

/** Parse an SSE body into text deltas via a per-event extractor. */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  extract: (json: unknown) => string,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const piece = extract(JSON.parse(data));
        if (piece) yield piece;
      } catch {
        // Ignore keep-alives / partial frames.
      }
    }
  }
}
