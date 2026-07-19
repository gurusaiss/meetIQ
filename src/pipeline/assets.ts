import type {
  Transcript,
  TopicSegment,
  KnowledgeAsset,
  RevisionNotes,
  Flashcard,
  Quiz,
  TranscriptSegment,
} from "../types.ts";
import type { LLMProvider } from "../providers/llm/types.ts";
import { ground, assetQuality } from "./grounding.ts";

/**
 * Generates the three v1 knowledge assets (notes, flashcards, quiz) from a
 * transcript + topics, grounding every statement and computing per-asset
 * quality. Assets that exceed the auto-hold flag ratio are marked
 * `auto_held` — they wait for the faculty approve gate (FR-14) rather than
 * going to students (NFR-1).
 */
export async function buildAssets(
  llm: LLMProvider,
  transcript: Transcript,
  topics: TopicSegment[],
  quality: { confidenceFlagThreshold: number; assetAutoHoldFlagRatio: number },
): Promise<KnowledgeAsset[]> {
  const segs = new Map(transcript.segments.map((s) => [s.id, s]));
  const th = quality.confidenceFlagThreshold;

  const notes = await buildNotes(llm, transcript, topics, segs, th);
  const flashcards = await buildFlashcards(llm, transcript, topics, segs, th);
  const quiz = await buildQuiz(llm, transcript, topics, segs, th);

  return [notes, flashcards, quiz].map((a) =>
    applyAutoHold(a, quality.assetAutoHoldFlagRatio),
  );
}

async function buildNotes(
  llm: LLMProvider,
  t: Transcript,
  topics: TopicSegment[],
  segs: Map<string, TranscriptSegment>,
  th: number,
): Promise<KnowledgeAsset> {
  const draft = await llm.writeNotes(t, topics);
  const all: Array<{ flagged: boolean; ungrounded: boolean }> = [];
  const content: RevisionNotes = {
    topics: draft.topics.map((topic, i) => ({
      title: topic.title,
      start: topics[i]?.start ?? 0,
      points: topic.points
        .map((p) => ground(p, segs, th))
        .filter((p) => {
          all.push(p);
          return !p.ungrounded; // drop ungrounded points from notes
        })
        .map(strip),
    })),
  };
  const q = assetQuality(all);
  return { type: "notes", status: "draft", content, ...q };
}

async function buildFlashcards(
  llm: LLMProvider,
  t: Transcript,
  topics: TopicSegment[],
  segs: Map<string, TranscriptSegment>,
  th: number,
): Promise<KnowledgeAsset> {
  const draft = await llm.makeFlashcards(t, topics);
  const all: Array<{ flagged: boolean; ungrounded: boolean }> = [];
  const cards: Flashcard[] = [];
  for (const c of draft.cards) {
    const back = ground(c.back, segs, th);
    all.push(back);
    if (back.ungrounded) continue;
    cards.push({ front: c.front, back: strip(back) });
  }
  const q = assetQuality(all);
  return { type: "flashcards", status: "draft", content: { cards }, ...q };
}

async function buildQuiz(
  llm: LLMProvider,
  t: Transcript,
  topics: TopicSegment[],
  segs: Map<string, TranscriptSegment>,
  th: number,
): Promise<KnowledgeAsset> {
  const draft = await llm.makeQuiz(t, topics);
  const all: Array<{ flagged: boolean; ungrounded: boolean }> = [];
  const content: Quiz = {
    questions: draft.questions
      .map((qq) => {
        const explanation = ground(qq.explanation, segs, th);
        all.push(explanation);
        return { qq, explanation };
      })
      // A quiz question whose explanation is ungrounded is untrustworthy —
      // drop it. This is where the mock's bogus "seg-9999" ref gets caught.
      .filter(({ explanation }) => !explanation.ungrounded)
      .map(({ qq, explanation }) => ({
        question: qq.question,
        options: qq.options,
        answerIndex: qq.answerIndex,
        explanation: strip(explanation),
      })),
  };
  const q = assetQuality(all);
  return { type: "quiz", status: "draft", content, ...q };
}

function applyAutoHold(a: KnowledgeAsset, ratio: number): KnowledgeAsset {
  return a.flagRatio > ratio ? { ...a, status: "auto_held" } : a;
}

/** drop the internal `ungrounded` marker before returning to callers */
function strip<T extends { ungrounded: boolean }>(
  s: T,
): Omit<T, "ungrounded"> {
  const { ungrounded, ...rest } = s;
  void ungrounded;
  return rest;
}
