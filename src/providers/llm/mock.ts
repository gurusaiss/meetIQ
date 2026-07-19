import type { Transcript, TopicSegment } from "../../types.ts";
import type {
  LLMProvider,
  TopicDraft,
  NotesDraft,
  FlashcardsDraft,
  QuizDraft,
} from "./types.ts";

/**
 * Deterministic mock "LLM". It produces genuinely useful, grounded drafts
 * from the transcript using simple heuristics so the whole pipeline runs
 * and is testable without a model or API key. Every draft cites REAL
 * segment ids, so grounding passes; low-confidence segments naturally flow
 * through to flagged statements.
 *
 * To prove the hallucination guard, makeQuiz intentionally emits one
 * statement citing a non-existent segment ("seg-9999") — the pipeline must
 * strip that ref and mark the statement ungrounded.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  async segmentTopics(t: Transcript): Promise<TopicDraft> {
    // Group consecutive segments; start a new topic on a >8s silence gap
    // or every 3 segments, whichever comes first.
    const topics: TopicDraft["topics"] = [];
    let current: string[] = [];
    let prevEnd: number | null = null;
    let firstText = "";

    const flush = () => {
      if (current.length === 0) return;
      topics.push({ title: titleFrom(firstText), segmentIds: [...current] });
      current = [];
      firstText = "";
    };

    for (const s of t.segments) {
      const gap = prevEnd === null ? 0 : s.start - prevEnd;
      if (current.length >= 3 || (gap > 8 && current.length > 0)) flush();
      if (current.length === 0) firstText = s.text;
      current.push(s.id);
      prevEnd = s.end;
    }
    flush();
    return { topics };
  }

  async writeNotes(t: Transcript, topics: TopicSegment[]): Promise<NotesDraft> {
    const byId = index(t);
    return {
      topics: topics.map((topic) => ({
        title: topic.title,
        points: topic.segmentIds.map((id) => {
          const seg = byId.get(id);
          return {
            text: bullet(seg?.text ?? ""),
            sourceRefs: [id],
          };
        }),
      })),
    };
  }

  async makeFlashcards(
    t: Transcript,
    topics: TopicSegment[],
  ): Promise<FlashcardsDraft> {
    const byId = index(t);
    const cards: FlashcardsDraft["cards"] = [];
    for (const topic of topics) {
      // Pick the "most definitional" segment of the topic as a card.
      const best = topic.segmentIds
        .map((id) => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .sort((a, b) => defScore(b.text) - defScore(a.text))[0];
      if (!best) continue;
      cards.push({
        front: `In "${topic.title}", what was said about this point?`,
        back: { text: best.text.trim(), sourceRefs: [best.id] },
      });
    }
    return { cards };
  }

  async makeQuiz(t: Transcript, topics: TopicSegment[]): Promise<QuizDraft> {
    const byId = index(t);
    const questions: QuizDraft["questions"] = [];
    topics.forEach((topic, i) => {
      const seg = byId.get(topic.segmentIds[0] ?? "");
      if (!seg) return;
      const correct = keyPhrase(seg.text);
      questions.push({
        question: `Which topic did the lecture cover around ${fmt(topic.start)}?`,
        options: shuffleStable(
          [topic.title, "An unrelated aside", "Administrative notes", correct],
          i,
        ),
        answerIndex: 0, // recomputed after shuffle below
        explanation: {
          text: `The lecture addressed "${topic.title}".`,
          // First question deliberately cites a bogus ref to exercise the
          // grounding guard; the rest cite real segments.
          sourceRefs: i === 0 ? ["seg-9999"] : [topic.segmentIds[0] ?? ""],
        },
      });
      // Fix answerIndex to wherever the title landed after the stable shuffle.
      const q = questions[questions.length - 1]!;
      q.answerIndex = Math.max(0, q.options.indexOf(topic.title));
    });
    return { questions };
  }
}

// ── helpers ─────────────────────────────────────────────────────────
function index(t: Transcript) {
  return new Map(t.segments.map((s) => [s.id, s]));
}
function titleFrom(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.replace(/[.,!?]$/, "") || "Untitled topic";
}
function bullet(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
function defScore(text: string): number {
  // crude "definitional" score: mentions of "is/are/means/defined"
  return (text.match(/\b(is|are|means|defined|refers to)\b/gi) ?? []).length +
    Math.min(text.length / 100, 2);
}
function keyPhrase(text: string): string {
  return text.trim().split(/\s+/).slice(0, 4).join(" ");
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function shuffleStable<T>(arr: T[], seed: number): T[] {
  // deterministic rotation so tests are stable
  const n = arr.length;
  const k = seed % n;
  return [...arr.slice(k), ...arr.slice(0, k)];
}
