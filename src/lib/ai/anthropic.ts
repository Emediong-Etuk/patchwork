import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/src/lib/config";
import { AIProviderUnavailableError, type ConversationOptions, type LLMConversation, type LLMProvider, type ToolResult, type Turn } from "./types";

// Models that accept the server-side refusal fallback ("default" form).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  availability(): { ok: true } | { ok: false; reason: string } {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
      return { ok: false, reason: "ANTHROPIC_API_KEY is not set. PATCHWORK agents cannot run without an AI provider; add the key to .env and restart." };
    return { ok: true };
  }

  private getClient() {
    const a = this.availability();
    if (!a.ok) throw new AIProviderUnavailableError(a.reason);
    if (!this.client) this.client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
    return this.client;
  }

  startConversation(opts: ConversationOptions): LLMConversation {
    return new AnthropicConversation(this.getClient(), opts);
  }
}

class AnthropicConversation implements LLMConversation {
  private messages: Anthropic.Beta.Messages.BetaMessageParam[];

  constructor(
    private readonly client: Anthropic,
    private readonly opts: ConversationOptions,
  ) {
    this.messages = [{ role: "user", content: opts.userText }];
  }

  async next(signal?: AbortSignal): Promise<Turn> {
    const useFallbacks = config().ANTHROPIC_FALLBACKS === "true" && FALLBACK_MODELS.has(this.opts.model);
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.opts.model,
          max_tokens: this.opts.maxTokens ?? 16000,
          // Stable prefix first so the system prompt and tools cache across turns.
          system: [{ type: "text", text: this.opts.system, cache_control: { type: "ephemeral" } }],
          tools: this.opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema })),
          tool_choice: { type: "auto" },
          messages: this.messages,
          ...(this.opts.effort ? { output_config: { effort: this.opts.effort } } : {}),
          ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AIProviderUnavailableError("Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.");
      if (err instanceof Anthropic.PermissionDeniedError) throw new AIProviderUnavailableError(`Anthropic denied access to ${this.opts.model} (403).`);
      if (err instanceof Anthropic.NotFoundError) throw new AIProviderUnavailableError(`Model ${this.opts.model} was not found (404). Check the *_MODEL settings.`);
      if (err instanceof Anthropic.RateLimitError) throw new AIProviderUnavailableError("Anthropic rate limit reached after retries (429). Try again shortly.");
      if (err instanceof Anthropic.APIConnectionError) throw new AIProviderUnavailableError(`Could not reach the Anthropic API: ${err.message}`);
      if (err instanceof Anthropic.InternalServerError) throw new AIProviderUnavailableError(`Anthropic API error ${err.status} after retries.`);
      throw err;
    }

    // Append the full content (thinking blocks included) unchanged.
    this.messages.push({ role: "assistant", content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });

    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolCalls = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const sr = response.stop_reason;
    return {
      stopReason: sr === "tool_use" ? "tool_use" : sr === "end_turn" ? "end_turn" : sr === "max_tokens" ? "max_tokens" : sr === "refusal" ? "refusal" : "other",
      text,
      toolCalls,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }

  addToolResults(results: ToolResult[]) {
    // All results for one assistant turn go back in a single user message.
    this.messages.push({
      role: "user",
      content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError ?? false })),
    });
  }

  addUserText(text: string) {
    this.messages.push({ role: "user", content: text });
  }
}
