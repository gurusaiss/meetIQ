import type { Transcript, TopicSegment, Chunk, SearchHit } from "../types.ts";
import {
  type EmbeddingsProvider,
  cosine,
} from "../providers/embeddings/index.ts";

/**
 * Builds RAG chunks from topics (one chunk per topic — a natural semantic
 * unit that keeps citations meaningful). In production these embeddings go
 * to pgvector; here we keep them on the Chunk for an in-memory search that
 * proves the retrieval + citation path.
 */
export async function buildChunks(
  embeddings: EmbeddingsProvider,
  transcript: Transcript,
  topics: TopicSegment[],
): Promise<Chunk[]> {
  const byId = new Map(transcript.segments.map((s) => [s.id, s]));
  const texts = topics.map((t) =>
    t.segmentIds
      .map((id) => byId.get(id)?.text ?? "")
      .join(" ")
      .trim(),
  );
  const vectors = await embeddings.embed(texts);
  return topics.map((t, i) => ({
    id: `${transcript.lectureId}:chunk:${t.id}`,
    lectureId: transcript.lectureId,
    text: texts[i] ?? "",
    segmentIds: t.segmentIds,
    start: t.start,
    embedding: vectors[i] ?? [],
  }));
}

/**
 * In-memory semantic search over chunks. Returns hits with the chunk (which
 * carries segmentIds + start) so every answer can cite an exact timestamp —
 * the "chat with your course" citation requirement (FR-10).
 */
export async function search(
  embeddings: EmbeddingsProvider,
  chunks: Chunk[],
  query: string,
  topK = 3,
): Promise<SearchHit[]> {
  const [q] = await embeddings.embed([query]);
  if (!q) return [];
  return chunks
    .map((chunk) => ({ chunk, score: cosine(q, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
