import { config } from "../../config.ts";
import type { LLMProvider } from "./types.ts";
import { MockLLMProvider } from "./mock.ts";
import { AnthropicLLMProvider } from "./anthropic.ts";

export type * from "./types.ts";

export function getLLMProvider(): LLMProvider {
  switch (config.providers.llm) {
    case "mock":
      return new MockLLMProvider();
    case "anthropic":
      return new AnthropicLLMProvider(config.keys.anthropic, config.llmModel);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.providers.llm}`);
  }
}
