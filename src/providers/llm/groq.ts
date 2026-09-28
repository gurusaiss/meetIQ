import type { Transcript, TopicSegment } from "../../types.ts";
import type {
  LLMProvider,
  TopicDraft,
  NotesDraft,
  FlashcardsDraft,
  QuizDraft,
} from "./types.ts";

/**
 * Real free-tier LLM provider via Groq's OpenAI-compatible chat completions
 * API, using `response_format: json_schema` with `strict: true` (constrained
 * decoding — the model's output is guaranteed to match the schema, not just
 * validated after the fact). Only a handful of models support `strict`
 * mode; `openai/gpt-oss-120b` is confirmed to (per Groq's own structured-
 * outputs docs) and is free-tier, so it's the default.
 *
 * Same contract as the Anthropic provider: every prompt requires the model
 * to cite real transcript segment ids in `sourceRefs`, and the pipeline's
 * grounding guard (grounding.ts, untouched) validates them independently —
 * this provider cannot mark its own homework any more than Anthropic's can.
 *
 * Strict mode requires every schema property to be in `required` (optional
 * fields are instead typed `[T, "null"]`) and `additionalProperties: false`
 * on every object — both already true of the schemas below.
 */
const BASE = "https://api.groq.com/openai/v1/chat/completions";

type SchemaObject = Record<string, unknown>;

export class GroqLLMProvider implements LLMProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = "openai/gpt-oss-120b") {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async segmentTopics(t: Transcript): Promise<TopicDraft> {
    return this.callJSON<TopicDraft>(
      "You segment a lecture transcript into coherent topics.",
      `Group the following transcript segments into topics, in order. Use ONLY the segment ids shown.\n\n${render(t)}`,
      "topics",
      TOPIC_SCHEMA,
    );
  }

  async writeNotes(t: Transcript, topics: TopicSegment[]): Promise<NotesDraft> {
    return this.callJSON<NotesDraft>(
      "You write faithful, exam-ready revision notes. Every point MUST be grounded in the transcript and cite the segment ids it is derived from. Do not invent facts.",
      `Write revision notes for these topics. For every point, set sourceRefs to the transcript segment ids that support it — cite only ids that appear below.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      "notes",
      NOTES_SCHEMA,
    );
  }

  async makeFlashcards(t: Transcript, topics: TopicSegment[]): Promise<FlashcardsDraft> {
    return this.callJSON<FlashcardsDraft>(
      "You create spaced-repetition flashcards. Each card's answer MUST cite the transcript segment ids it is derived from.",
      `Create flashcards (front question, back answer) for these topics. Cite only segment ids shown.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      "flashcards",
      FLASHCARDS_SCHEMA,
    );
  }

  async makeQuiz(t: Transcript, topics: TopicSegment[]): Promise<QuizDraft> {
    return this.callJSON<QuizDraft>(
      "You write multiple-choice quiz questions. Exactly one option is correct (answerIndex). The explanation MUST cite the transcript segment ids it is derived from.",
      `Write one MCQ per topic. Each has 3-4 options, a correct answerIndex, and an explanation citing only segment ids shown.\n\nTopics:\n${topics.map((x) => `- ${x.title} [${x.segmentIds.join(", ")}]`).join("\n")}\n\nTranscript:\n${render(t)}`,
      "quiz",
      QUIZ_SCHEMA,
    );
  }

  private async callJSON<T>(
    system: string,
    user: string,
    schemaName: string,
    schema: SchemaObject,
  ): Promise<T> {
    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Groq chat completion failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices[0]?.message.content;
    if (!content) throw new Error("Groq response contained no message content");
    return JSON.parse(content) as T;
  }
}

// ── prompt rendering ────────────────────────────────────────────────
function render(t: Transcript): string {
  return t.segments
    .map((s) => `[${s.id}] (${s.speaker ?? "?"}) ${s.text}`)
    .join("\n");
}

// ── structured-output schemas (strict mode: additionalProperties:false,
// every property required, everywhere) ──
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
