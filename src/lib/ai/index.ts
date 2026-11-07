import { config } from "@/src/lib/config";
import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./types";

export * from "./types";

const g = globalThis as unknown as { __patchworkProvider?: LLMProvider };

export function getProvider(): LLMProvider {
  if (!g.__patchworkProvider) {
    const name = config().AI_PROVIDER;
    if (name !== "anthropic") throw new Error(`Unsupported AI provider ${name}`);
    g.__patchworkProvider = new AnthropicProvider();
  }
  return g.__patchworkProvider;
}

/** Test hook: install a scripted provider. Never used by the running app. */
export function setProviderForTests(p: LLMProvider | undefined) {
  g.__patchworkProvider = p;
}
