import type { Transcript } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";

/**
 * Real AssemblyAI provider (default recommended engine — best far-field
 * diarization per Phase 1 research). Guarded: it only requires the SDK /
 * key when actually selected, so the mock path stays dependency-free.
 *
 * Wiring is intentionally left as a single well-marked integration point
 * for Increment 2; the contract (TranscriptionProvider) is already stable.
 */
export class AssemblyAITranscriptionProvider implements TranscriptionProvider {
  readonly name = "assemblyai";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "ASSEMBLYAI_API_KEY is required when TRANSCRIPTION_PROVIDER=assemblyai",
      );
    }
    this.apiKey = apiKey;
  }

  async transcribe(_opts: TranscribeOptions): Promise<Transcript> {
    // Increment 2: POST media, enable speaker_labels + best model, poll,
    // then map word-level confidences into TranscriptSegment.confidence.
    // Keeping the throw explicit avoids silently shipping empty results.
    throw new Error(
      "AssemblyAI integration lands in Increment 2. Use TRANSCRIPTION_PROVIDER=mock for now.",
    );
  }
}
