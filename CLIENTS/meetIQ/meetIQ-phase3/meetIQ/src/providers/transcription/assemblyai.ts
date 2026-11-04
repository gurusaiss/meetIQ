import { readFile } from "node:fs/promises";
import type { Transcript, TranscriptSegment } from "../../types.ts";
import type { TranscribeOptions, TranscriptionProvider } from "./types.ts";

/**
 * Real AssemblyAI provider (default recommended engine — best far-field
 * diarization per Phase 1 research). Uses plain fetch (no SDK).
 *
 * NOTE: implemented against AssemblyAI's documented async REST API, but not
 * yet exercised against the live service in this environment (no API key).
 * The mock provider remains the default; this activates only when
 * TRANSCRIPTION_PROVIDER=assemblyai and a key is present.
 */
const BASE = "https://api.assemblyai.com/v2";

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

  async transcribe(opts: TranscribeOptions): Promise<Transcript> {
    const audioUrl = await this.resolveAudioUrl(opts.mediaRef);

    // Kick off async transcription with speaker diarization (moat #1).
    const created = await this.post(`${BASE}/transcript`, {
      audio_url: audioUrl,
      speaker_labels: opts.diarize ?? true,
      // Universal model + word-level timestamps; batch (async) = cheaper.
      speech_model: "best",
      punctuate: true,
      format_text: true,
    });
    const id = created.id as string;

    // Poll to completion.
    const result = await this.poll(id);
    if (result.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${result.error}`);
    }

    return {
      lectureId: opts.lectureId,
      language: (result.language_code as string) ?? "en",
      provider: this.name,
      segments: this.toSegments(result, opts.speakerHints),
    };
  }

  /** If mediaRef is a URL use it; otherwise upload the local file. */
  private async resolveAudioUrl(mediaRef: string): Promise<string> {
    if (/^https?:\/\//i.test(mediaRef)) return mediaRef;
    const bytes = await readFile(mediaRef);
    const res = await fetch(`${BASE}/upload`, {
      method: "POST",
      headers: { authorization: this.apiKey },
      body: bytes,
    });
    if (!res.ok) throw new Error(`AssemblyAI upload failed: ${res.status}`);
    const json = (await res.json()) as { upload_url: string };
    return json.upload_url;
  }

  private async poll(id: string): Promise<Record<string, unknown>> {
    const maxAttempts = 120; // ~10 min at 5s
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(`${BASE}/transcript/${id}`, {
        headers: { authorization: this.apiKey },
      });
      if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.status === "completed" || json.status === "error") return json;
      await sleep(5000);
    }
    throw new Error("AssemblyAI transcription timed out");
  }

  /** Map AssemblyAI utterances → confidence-bearing TranscriptSegments. */
  private toSegments(
    result: Record<string, unknown>,
    hints?: Record<string, string>,
  ): TranscriptSegment[] {
    const utterances = result.utterances as
      | Array<{ speaker: string; text: string; start: number; end: number; confidence: number }>
      | undefined;
    if (!utterances || utterances.length === 0) {
      throw new Error(
        "AssemblyAI returned no diarized utterances; enable speaker_labels or use a clearer recording.",
      );
    }
    return utterances.map((u, i) => {
      const speakerKey = `SPEAKER_${u.speaker}`;
      return {
        id: `seg-${i}`,
        start: u.start / 1000,
        end: u.end / 1000,
        speaker: hints?.[speakerKey] ?? speakerKey,
        text: u.text,
        confidence: u.confidence,
      };
    });
  }

  private async post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: this.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`AssemblyAI request failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
