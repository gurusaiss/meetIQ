import { readFile } from "node:fs/promises";
import type { Transcript, TranscriptSegment } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";

/** mediaRef prefix that routes a lecture to this provider (see pipeline.ts). */
export const TEXT_REF_PREFIX = "text://";

const WORDS_PER_SECOND = 2.5; // ~150 wpm, only used to give each segment a position
const MAX_WORDS_PER_SEGMENT = 45;

/**
 * "Transcription" for typed/pasted/uploaded text. There is no speech
 * recognition step, so every segment gets confidence 1: the text IS the
 * source. Segments are sentences; timestamps are positional estimates (reading
 * time), not real audio offsets. The grounding guard still applies — every
 * generated statement must cite a real segment of this text.
 */
export class TextTranscriptionProvider implements TranscriptionProvider {
  readonly name = "text";

  async transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const path = opts.mediaRef.slice(TEXT_REF_PREFIX.length);
    const raw = await readFile(path, "utf8");
    const segments = splitIntoSegments(raw);
    if (segments.length === 0) throw new Error("The text input is empty.");
    return { lectureId: opts.lectureId, language: "en", segments, provider: this.name };
  }
}

export function splitIntoSegments(raw: string): TranscriptSegment[] {
  const sentences = raw
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap(chunkLong);

  let t = 0;
  return sentences.map((text, i) => {
    const dur = Math.max(1, text.split(" ").length / WORDS_PER_SECOND);
    const seg: TranscriptSegment = {
      id: `seg-${i}`,
      start: Math.round(t * 10) / 10,
      end: Math.round((t + dur) * 10) / 10,
      speaker: null,
      text,
      confidence: 1,
    };
    t += dur;
    return seg;
  });
}

function chunkLong(sentence: string): string[] {
  const words = sentence.split(" ");
  if (words.length <= MAX_WORDS_PER_SEGMENT) return [sentence];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_SEGMENT) {
    out.push(words.slice(i, i + MAX_WORDS_PER_SEGMENT).join(" "));
  }
  return out;
}
