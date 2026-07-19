import type Anthropic from "@anthropic-ai/sdk";
import type { Transcript, TopicSegment } from "../../types.ts";
import type {
  LLMProvider,
  TopicDraft,
  NotesDraft,
  FlashcardsDraft,
  QuizDraft,
} from "./types.ts";

/**
 * Real Claude-backed provider via the official @anthropic-ai/sdk.
 *
 * Design:
 *  - Structured outputs (output_config.format) force schema-valid JSON.
 *  - Every prompt passes numbered transcript segments and REQUIRES the model
 *    to cite segment ids in `sourceRefs`. The pipeline's grounding guard then
 *    validates those ids — the model cannot fake grounding.
 *  - Cost tiering: `effort: "low"` for mechanical stages, thinking disabled
 *    for these extraction tasks (deterministic, cheaper).
 *
 * The SDK is imported dynamically so the mock path stays dependency-free; the
 * type-only import above is erased at runtime. NOTE: implemented against the
 * current Messages API but not yet exercised live here (no API key).
 */
type SchemaObject = Record<string, unknown>;

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private client: Anthropic | null = null;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      const mod = await import("@anthropic-ai/sdk");
      this.client = new mod.default({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async segmentTopics(t: Transcript): Promise<TopicDraft> {
    return this.callJSON<TopicDraft>(
      "You segment a lecture transcript into coherent topics.",
      `Group the following transcript segments into topics, in order. Use ONLY the segment ids shown.\n\n${render(t)}`,
      TOPIC_SCHEMA,
      "low",
    );
  }

  async writeNotes(t: Transcript, topics: TopicSegment[]): Promise<NotesDraft> {
    return this.callJSON<NotesDraft>(
      "You write faithful, exam-ready revision notes. Every point MUST be grounded in the transcript and cite the segment ids it is derived from. Do not invent facts.",
      `Write revision notes for these topics. For every point, set sourceRefs to the transcript segment ids that support it — cite only ids that appear below.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      NOTES_SCHEMA,
      "medium",
    );
  }

  async makeFlashcards(t: Transcript, topics: TopicSegment[]): Promise<FlashcardsDraft> {
    return this.callJSON<FlashcardsDraft>(
      "You create spaced-repetition flashcards. Each card's answer MUST cite the transcript segment ids it is derived from.",
      `Create flashcards (front question, back answer) for these topics. Cite only segment ids shown.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      FLASHCARDS_SCHEMA,
      "low",
    );
  }

  async makeQuiz(t: Transcript, topics: TopicSegment[]): Promise<QuizDraft> {
    return this.callJSON<QuizDraft>(
      "You write multiple-choice quiz questions. Exactly one option is correct (answerIndex). The explanation MUST cite the transcript segment ids it is derived from.",
      `Write one MCQ per topic. Each has 3-4 options, a correct answerIndex, and an explanation citing only segment ids shown.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      QUIZ_SCHEMA,
      "medium",
    );
  }

  private async callJSON<T>(
    system: string,
    user: string,
    schema: SchemaObject,
    effort: "low" | "medium" | "high",
  ): Promise<T> {
    const client = await this.getClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 8000,
      // Extraction tasks: thinking off for determinism + cost; effort tiers spend.
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema }, effort },
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("Anthropic response contained no text block");
    }
    return JSON.parse(text.text) as T;
  }
}

// ── prompt rendering ────────────────────────────────────────────────
function render(t: Transcript): string {
  return t.segments
    .map((s) => `[${s.id}] (${s.speaker ?? "?"}) ${s.text}`)
    .join("\n");
}

// ── structured-output schemas (additionalProperties:false everywhere) ──
const REFS: SchemaObject = { type: "array", items: { type: "string" } };
const STATEMENT: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["text", "sourceRefs"],
  properties: { text: { type: "string" }, sourceRefs: REFS },
};

const TOPIC_SCHEMA: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "segmentIds"],
        properties: { title: { type: "string" }, segmentIds: REFS },
      },
    },
  },
};

const NOTES_SCHEMA: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "points"],
        properties: {
          title: { type: "string" },
          points: { type: "array", items: STATEMENT },
        },
      },
    },
  },
};

const FLASHCARDS_SCHEMA: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["front", "back"],
        properties: { front: { type: "string" }, back: STATEMENT },
      },
    },
  },
};

const QUIZ_SCHEMA: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "answerIndex", "explanation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answerIndex: { type: "integer" },
          explanation: STATEMENT,
        },
      },
    },
  },
};
