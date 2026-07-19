import type { Transcript, TopicSegment } from "../types.ts";
import type { LLMProvider } from "../providers/llm/types.ts";

/**
 * Topic segmentation. The LLM proposes topic groupings by segment id; we
 * resolve those into TopicSegment with real time bounds and the minimum
 * segment confidence (so a topic built on shaky far-field audio is visibly
 * risky before any asset is generated).
 */
export async function segmentTopics(
  llm: LLMProvider,
  transcript: Transcript,
): Promise<TopicSegment[]> {
  const byId = new Map(transcript.segments.map((s) => [s.id, s]));
  const draft = await llm.segmentTopics(transcript);

  const topics: TopicSegment[] = [];
  draft.topics.forEach((t, i) => {
    const segs = t.segmentIds
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (segs.length === 0) return;
    topics.push({
      id: `topic-${i}`,
      title: t.title,
      segmentIds: segs.map((s) => s.id),
      start: Math.min(...segs.map((s) => s.start)),
      end: Math.max(...segs.map((s) => s.end)),
      minConfidence: Math.min(...segs.map((s) => s.confidence)),
    });
  });
  return topics;
}
