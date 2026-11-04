import type { PipelineResult } from "../types.ts";
import { config } from "../config.ts";
import { getTranscriptionProvider } from "../providers/transcription/index.ts";
import {
  TextTranscriptionProvider,
  TEXT_REF_PREFIX,
} from "../providers/transcription/text.ts";
import { getLLMProvider } from "../providers/llm/index.ts";
import { getEmbeddingsProvider } from "../providers/embeddings/index.ts";
import { segmentTopics } from "./segment.ts";
import { buildAssets } from "./assets.ts";
import { buildChunks } from "./rag.ts";

export interface ProcessLectureInput {
  lectureId: string;
  mediaRef: string;
  diarize?: boolean;
  speakerHints?: Record<string, string>;
}

/**
 * The end-to-end batch pipeline (Phase 11):
 *   transcribe → segment → [notes | flashcards | quiz] → embed/index
 *
 * Providers are resolved from config, so the same code runs on mocks
 * (zero keys) or real engines. Intermediate outputs (transcript, topics)
 * are computed once and reused across all asset types — the core cost
 * optimization (don't re-transcribe or re-segment per asset).
 */
export async function processLecture(
  input: ProcessLectureInput,
): Promise<PipelineResult> {
  // Typed/pasted/uploaded text skips speech-to-text entirely.
  const transcription = input.mediaRef.startsWith(TEXT_REF_PREFIX)
    ? new TextTranscriptionProvider()
    : getTranscriptionProvider();
  const llm = getLLMProvider();
  const embeddings = getEmbeddingsProvider();

  const transcript = await transcription.transcribe({
    lectureId: input.lectureId,
    mediaRef: input.mediaRef,
    diarize: input.diarize ?? true,
    speakerHints: input.speakerHints,
  });

  const topics = await segmentTopics(llm, transcript);
  const assets = await buildAssets(llm, transcript, topics, config.quality);
  const chunks = await buildChunks(embeddings, transcript, topics);

  return { transcript, topics, assets, chunks };
}
