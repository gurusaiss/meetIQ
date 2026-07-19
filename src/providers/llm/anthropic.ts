import type { Transcript, TopicSegment } from "../../types.ts";
import type {
  LLMProvider,
  TopicDraft,
  NotesDraft,
  FlashcardsDraft,
  QuizDraft,
} from "./types.ts";

/**
 * Real Claude-backed provider. Guarded stub for Increment 2: the contract
 * is stable, so wiring the Anthropic SDK here does not touch the pipeline.
 *
 * Implementation plan (Inc 2):
 *  - Build prompts that pass numbered transcript segments and REQUIRE the
 *    model to cite segment ids for every statement (sourceRefs). The
 *    pipeline then validates those ids — the model cannot fake grounding.
 *  - Cost tiering: cheap model for segmentation, stronger model for notes.
 *  - Cache keyed on transcript hash so re-runs are free.
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  private notImplemented(): never {
    throw new Error(
      "Anthropic LLM integration lands in Increment 2. Use LLM_PROVIDER=mock for now.",
    );
  }

  async segmentTopics(_t: Transcript): Promise<TopicDraft> {
    return this.notImplemented();
  }
  async writeNotes(_t: Transcript, _topics: TopicSegment[]): Promise<NotesDraft> {
    return this.notImplemented();
  }
  async makeFlashcards(
    _t: Transcript,
    _topics: TopicSegment[],
  ): Promise<FlashcardsDraft> {
    return this.notImplemented();
  }
  async makeQuiz(_t: Transcript, _topics: TopicSegment[]): Promise<QuizDraft> {
    return this.notImplemented();
  }
}
