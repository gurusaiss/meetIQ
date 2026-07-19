/**
 * Core domain types for the Lecture Intelligence pipeline.
 *
 * Design note: `confidence` and `sourceRefs` are first-class on almost
 * everything. That is deliberate — moat #1 (far-field trust) and the
 * hallucination guard both depend on confidence and grounding being
 * carried end-to-end, not bolted on at the UI.
 */

/** A single recognized span of speech with word-level confidence. */
export interface TranscriptSegment {
  /** Stable id, unique within a transcript. Used as a grounding anchor. */
  id: string;
  /** Seconds from lecture start. */
  start: number;
  end: number;
  /** Diarization label, e.g. "SPEAKER_0" (instructor) — may be unknown. */
  speaker: string | null;
  text: string;
  /** 0..1. Averaged word confidence for the span. Low = far-field trouble. */
  confidence: number;
}

export interface Transcript {
  lectureId: string;
  language: string;
  segments: TranscriptSegment[];
  /** Provider that produced this, for audit + reproducibility. */
  provider: string;
}

/** A contiguous run of segments the model judged to be one topic. */
export interface TopicSegment {
  id: string;
  title: string;
  /** Segment ids covered, in order. Grounding anchor for downstream assets. */
  segmentIds: string[];
  start: number;
  end: number;
  /** Lowest-confidence segment in the topic — surfaces far-field risk. */
  minConfidence: number;
}

/**
 * A generated statement that MUST be traceable to transcript segments.
 * If `sourceRefs` is empty, the grounding guard treats it as ungrounded.
 */
export interface GroundedStatement {
  text: string;
  /** Transcript segment ids this statement is derived from. */
  sourceRefs: string[];
  /** Derived from the confidence of the cited segments. */
  confidence: number;
  /** True when segment confidence is below the flag threshold. */
  flagged: boolean;
}

export interface RevisionNotes {
  topics: Array<{
    title: string;
    points: GroundedStatement[];
    /** seconds — click-to-timestamp target for the topic. */
    start: number;
  }>;
}

export interface Flashcard {
  front: string;
  back: GroundedStatement;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** index into options */
  answerIndex: number;
  explanation: GroundedStatement;
}

export interface Quiz {
  questions: QuizQuestion[];
}

/** RAG chunk with its embedding. */
export interface Chunk {
  id: string;
  lectureId: string;
  text: string;
  segmentIds: string[];
  start: number;
  embedding: number[];
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

export type AssetType = "notes" | "flashcards" | "quiz";
export type AssetStatus = "draft" | "auto_held" | "approved";

export interface KnowledgeAsset {
  type: AssetType;
  status: AssetStatus;
  content: RevisionNotes | { cards: Flashcard[] } | Quiz;
  /** fraction of statements flagged as low-confidence */
  flagRatio: number;
  /** fraction of statements with zero grounding (should be ~0) */
  ungroundedRatio: number;
}

export interface PipelineResult {
  transcript: Transcript;
  topics: TopicSegment[];
  assets: KnowledgeAsset[];
  chunks: Chunk[];
}
