import type { Transcript } from "../../types.ts";

export interface TranscribeOptions {
  lectureId: string;
  /** Path or URL to media. Mock ignores it and uses a fixture. */
  mediaRef: string;
  /** Enable speaker diarization (moat #1). */
  diarize?: boolean;
  /** Known speaker enrollments, e.g. { SPEAKER_0: "Prof. Anika" }. */
  speakerHints?: Record<string, string>;
}

/**
 * A transcription engine. Implementations are interchangeable so a
 * deployment can pick the best far-field engine without touching the
 * pipeline (moat #1). Batch/async by contract — cheaper than streaming.
 */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(opts: TranscribeOptions): Promise<Transcript>;
}
