/** Public surface of the value-engine core. */
export * from "./types.ts";
export { config } from "./config.ts";
export { processLecture } from "./pipeline/pipeline.ts";
export type { ProcessLectureInput } from "./pipeline/pipeline.ts";
export { search } from "./pipeline/rag.ts";
export { getEmbeddingsProvider } from "./providers/embeddings/index.ts";

// persistence + service layer (Increment 2)
export { SqliteRepository } from "./persistence/sqlite.ts";
export type { Repository } from "./persistence/repository.ts";
export {
  LectureService,
  ComplianceError,
  AuthorizationError,
} from "./services/lecture-service.ts";
export type { Actor, Role, CreateLectureInput } from "./services/lecture-service.ts";
