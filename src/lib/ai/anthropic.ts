import type { AIProvider, ChatMessage, GenerateOptions } from "./types";

// Minimal Anthropic Messages client (SSE streaming). Respects ANTHROPIC_BASE_URL
// so it works behind a proxy/gateway as well as the public API.
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  readonly isMock = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async *streamText(options: GenerateOptions): AsyncIterable<string> {
    // Anthropic takes `system` separately from the message list.
    const system = options.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages: ChatMessage[] = options.messages.filter((m) => m.role !== "system");

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: options.signal,
      body: JSON.stringify({
        model: this.model,
        stream: true,
        max_tokens: options.maxTokens ?? 2048,
        // `temperature` is deprecated/rejected on newer models (e.g. Sonnet 5);
        // only send it when explicitly opted in via ANTHROPIC_SEND_TEMPERATURE.
        ...(process.env.ANTHROPIC_SEND_TEMPERATURE && options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(system ? { system } : {}),
        messages,
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic request failed (${res.status}): ${detail}`);
    }

    const reader = res.body.getReader();
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
        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          if (json.type === "content_block_delta" && json.delta?.text) {
            yield json.delta.text as string;
          }
        } catch {
          // Ignore event frames / keep-alives.
        }
      }
    }
  }

  async generateText(options: GenerateOptions): Promise<string> {
    let out = "";
    for await (const chunk of this.streamText(options)) out += chunk;
    return out;
  }
}
