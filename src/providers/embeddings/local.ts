import type { EmbeddingsProvider } from "./index.ts";

/**
 * Real embeddings with zero external API — runs a small sentence-embedding
 * model in-process via `@huggingface/transformers` (ONNX Runtime, CPU/WASM;
 * no GPU/WebGPU required, so this works on a plain Node server).
 *
 * Model: `onnx-community/all-MiniLM-L6-v2-ONNX` — 384-dim, ~90MB, the
 * standard lightweight sentence-embedding choice. Chosen specifically so the
 * whole stack needs exactly one external API key (Groq, for transcription +
 * generation) and nothing else for search to work.
 *
 * The pipeline is loaded lazily and cached (first call pays the model-load
 * cost; every call after reuses it) since construction happens per-request
 * in this codebase (`getEmbeddingsProvider()`), not once at startup.
 */
const MODEL = "onnx-community/all-MiniLM-L6-v2-ONNX";

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ tolist(): number[][] }>;

let cachedPipeline: Promise<FeatureExtractionPipeline> | null = null;

function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (!cachedPipeline) {
    cachedPipeline = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL) as unknown as Promise<FeatureExtractionPipeline>,
    );
  }
  return cachedPipeline;
}

export class LocalEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "local";
  readonly dim = 384;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await loadPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }
}
