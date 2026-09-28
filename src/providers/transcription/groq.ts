import { readFile } from "node:fs/promises";
import type { Transcript, TranscriptSegment } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";

/**
 * Real transcription via Groq's free-tier Whisper endpoint
 * (OpenAI-compatible `/audio/transcriptions`, model `whisper-large-v3-turbo`).
 *
 * Two honest limitations vs. the AssemblyAI provider, both inherent to
 * Whisper itself (not something this integration can add):
 *  - No speaker diarization. Whisper has no notion of "who spoke" — every
 *    segment's `speaker` is `null`. `speakerHints` is accepted (for
 *    interface parity) but has nothing to map onto.
 *  - No true per-word confidence score. Whisper exposes `avg_logprob`
 *    (a log-probability, roughly 0 to -1+ for confident-to-uncertain
 *    speech) and `no_speech_prob`. We convert those into a 0..1 confidence
 *    proxy (`toConfidence` below) — a reasonable heuristic, not a claim
 *    that it's equivalent to a real per-word confidence model. The far-field
 *    confidence-propagation path (moat #1) still exercises correctly on
 *    whatever this proxy produces; it's just a coarser signal than
 *    AssemblyAI's.
 */
const BASE = "https://api.groq.com/openai/v1/audio/transcriptions";

export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = "whisper-large-v3-turbo") {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required when TRANSCRIPTION_PROVIDER=groq");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const bytes = await this.resolveAudioBytes(opts.mediaRef);

    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)]), "audio");
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    // Word-level timestamps give finer-grained segments than the default
    // sentence-level ones; we still fall back to segment-level below if a
    // provider response omits them.
    form.set("timestamp_granularities[]", "segment");

    const res = await fetch(BASE, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      language?: string;
      segments?: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
        avg_logprob: number;
        no_speech_prob: number;
      }>;
    };

    const segments = json.segments ?? [];
    if (segments.length === 0) {
      throw new Error("Groq returned no transcript segments — check the audio file/URL.");
    }

    return {
      lectureId: opts.lectureId,
      language: json.language ?? "en",
      provider: this.name,
      segments: segments.map((s): TranscriptSegment => ({
        id: `seg-${s.id}`,
        start: s.start,
        end: s.end,
        speaker: null,
        text: s.text.trim(),
        confidence: toConfidence(s.avg_logprob, s.no_speech_prob),
      })),
    };
  }

  /** Local path is read from disk; a URL is fetched first — Whisper needs raw bytes either way. */
  private async resolveAudioBytes(mediaRef: string): Promise<ArrayBuffer> {
    if (/^https?:\/\//i.test(mediaRef)) {
      const res = await fetch(mediaRef);
      if (!res.ok) throw new Error(`Fetching media from ${mediaRef} failed: ${res.status}`);
      return res.arrayBuffer();
    }
    const buf = await readFile(mediaRef);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
}

/**
 * Whisper's avg_logprob is a log-probability (0 = certain, more negative =
 * less certain — in practice mostly in [-1, 0] for intelligible speech).
 * no_speech_prob further discounts segments Whisper itself flagged as
 * likely silence/noise. Neither is a calibrated 0..1 confidence, but this
 * combination gives a monotonic, bounded proxy that behaves the same way
 * a real confidence score would for this pipeline's purposes: clear speech
 * scores high, mumbled/far-field/noisy audio scores low.
 */
function toConfidence(avgLogprob: number, noSpeechProb: number): number {
  const fromLogprob = clamp01(1 + avgLogprob);
  return clamp01(fromLogprob * (1 - noSpeechProb));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
