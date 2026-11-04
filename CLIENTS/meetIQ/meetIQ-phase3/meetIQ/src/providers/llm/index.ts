import { config } from "../../config.ts";
import type { LLMProvider } from "./types.ts";
import { MockLLMProvider } from "./mock.ts";
import { AnthropicLLMProvider } from "./anthropic.ts";
import { GroqLLMProvider } from "./groq.ts";

export type * from "./types.ts";

export function getLLMProvider(): LLMProvider {
  switch (config.providers.llm) {
    case "mock":
      return new MockLLMProvider();
    case "anthropic":
      return new AnthropicLLMProvider(config.keys.anthropic, config.llmModel || undefined);
    case "groq":
      return new GroqLLMProvider(config.keys.groq, config.llmModel || undefined);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.providers.llm}`);
  }
}
