import type { Transcript, TopicSegment } from "../../types.ts";

/**
 * LLM drafts carry *claimed* source references (transcript segment ids).
 * The pipeline validates them against real segments — an LLM cannot mark
 * its own homework. This is the provider-independent hallucination guard.
 */
export interface StatementDraft {
  text: string;
  /** Segment ids the model claims support this. Validated downstream. */
  sourceRefs: string[];
}

export interface TopicDraft {
  topics: Array<{ title: string; segmentIds: string[] }>;
}

export interface NotesDraft {
  topics: Array<{ title: string; points: StatementDraft[] }>;
}

export interface FlashcardsDraft {
  cards: Array<{ front: string; back: StatementDraft }>;
}

export interface QuizDraft {
  questions: Array<{
    question: string;
    options: string[];
    answerIndex: number;
    explanation: StatementDraft;
  }>;
}

/**
 * Domain-aware LLM contract. Mock implements deterministically; real
 * implementations build prompts + parse JSON. Cost tiering (cheap model
 * first) and caching are the implementation's concern, hidden here.
 */
export interface LLMProvider {
  readonly name: string;
  segmentTopics(t: Transcript): Promise<TopicDraft>;
  writeNotes(t: Transcript, topics: TopicSegment[]): Promise<NotesDraft>;
  makeFlashcards(t: Transcript, topics: TopicSegment[]): Promise<FlashcardsDraft>;
  makeQuiz(t: Transcript, topics: TopicSegment[]): Promise<QuizDraft>;
}
