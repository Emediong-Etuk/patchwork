/**
 * Provider-neutral contract for running an agent's tool-use conversation.
 * The agent loop (src/agents/base) only depends on this, so providers can be
 * swapped without touching agent code.
 */
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type ToolCall = { id: string; name: string; input: unknown };

export type Turn = {
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other";
  text: string;
  toolCalls: ToolCall[];
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export type ToolResult = { id: string; content: string; isError?: boolean };

export interface LLMConversation {
  /** Send the conversation so far and get the model's next turn. */
  next(signal?: AbortSignal): Promise<Turn>;
  addToolResults(results: ToolResult[]): void;
  addUserText(text: string): void;
}

export type ConversationOptions = {
  model: string;
  system: string;
  userText: string;
  tools: ToolSpec[];
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
};

export interface LLMProvider {
  readonly name: string;
  /** Whether the provider can be used right now, and why not. */
  availability(): { ok: true } | { ok: false; reason: string };
  startConversation(opts: ConversationOptions): LLMConversation;
}

/** The provider cannot be reached or is not configured. Never retried silently into a fake result. */
export class AIProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderUnavailableError";
  }
}
