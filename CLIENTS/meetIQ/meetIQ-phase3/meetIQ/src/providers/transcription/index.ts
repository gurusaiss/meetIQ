import { config } from "../../config.ts";
import type { TranscriptionProvider } from "./types.ts";
import { MockTranscriptionProvider } from "./mock.ts";
import { AssemblyAITranscriptionProvider } from "./assemblyai.ts";
import { GroqTranscriptionProvider } from "./groq.ts";

export type { TranscriptionProvider, TranscribeOptions } from "./types.ts";

export function getTranscriptionProvider(): TranscriptionProvider {
  switch (config.providers.transcription) {
    case "mock":
      return new MockTranscriptionProvider();
    case "assemblyai":
      return new AssemblyAITranscriptionProvider(config.keys.assemblyai);
    case "groq":
      return new GroqTranscriptionProvider(config.keys.groq);
    default:
      throw new Error(
        `Unknown TRANSCRIPTION_PROVIDER: ${config.providers.transcription}`,
      );
  }
}
