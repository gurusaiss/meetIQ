import type { Transcript, TranscriptSegment } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";
import fixture from "../../../sample-data/lecture-transcript.json" with { type: "json" };

/**
 * Mock transcription. Loads a fixture that deliberately includes some
 * LOW-confidence, far-field-style segments so the confidence/grounding
 * machinery downstream is exercised realistically (not a happy path).
 *
 * Imported as a JSON module rather than read from disk at runtime — a
 * `readFile(fileURLToPath(new URL(...)))` path resolution here broke under
 * webpack bundling (the Next.js presentation layer): `import.meta.url`
 * inside a bundled chunk doesn't correspond to a real on-disk `file:` URL,
 * so the resulting URL object fails Node's `instanceof URL` realm check
 * deep inside `readFile`. A static JSON import has no such runtime path to
 * resolve — both Node's native loader and webpack handle it directly.
 */
const parsedFixture = fixture as { language: string; segments: TranscriptSegment[] };

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock";

  async transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const segments = parsedFixture.segments.map((s) => ({
      ...s,
      speaker: applyHint(s.speaker, opts.speakerHints),
    }));

    return {
      lectureId: opts.lectureId,
      language: parsedFixture.language,
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
