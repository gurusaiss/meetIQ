import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Transcript, TranscriptSegment } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";

/**
 * Mock transcription. Loads a fixture that deliberately includes some
 * LOW-confidence, far-field-style segments so the confidence/grounding
 * machinery downstream is exercised realistically (not a happy path).
 */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock";

  async transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const fixtureUrl = new URL(
      "../../../sample-data/lecture-transcript.json",
      import.meta.url,
    );
    const raw = await readFile(fileURLToPath(fixtureUrl), "utf8");
    const parsed = JSON.parse(raw) as {
      language: string;
      segments: TranscriptSegment[];
    };

    const segments = parsed.segments.map((s) => ({
      ...s,
      speaker: applyHint(s.speaker, opts.speakerHints),
    }));

    return {
      lectureId: opts.lectureId,
      language: parsed.language,
      segments,
      provider: this.name,
    };
  }
}

function applyHint(
  speaker: string | null,
  hints?: Record<string, string>,
): string | null {
  if (!speaker || !hints) return speaker;
  return hints[speaker] ?? speaker;
}
