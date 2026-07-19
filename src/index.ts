/** Public surface of the value-engine core. */
export * from "./types.ts";
export { config } from "./config.ts";
export { processLecture } from "./pipeline/pipeline.ts";
export type { ProcessLectureInput } from "./pipeline/pipeline.ts";
export { search } from "./pipeline/rag.ts";
export { getEmbeddingsProvider } from "./providers/embeddings/index.ts";
