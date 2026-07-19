import { test } from "node:test";
import assert from "node:assert/strict";
import { processLecture } from "../src/pipeline/pipeline.ts";
import { search } from "../src/pipeline/rag.ts";
import { getEmbeddingsProvider } from "../src/providers/embeddings/index.ts";
import { ground } from "../src/pipeline/grounding.ts";
import type { TranscriptSegment, RevisionNotes, Quiz } from "../src/types.ts";

const input = {
  lectureId: "test-lec",
  mediaRef: "irrelevant-for-mock",
  diarize: true,
};

test("pipeline runs end-to-end and produces all three asset types", async () => {
  const r = await processLecture(input);
  assert.equal(r.transcript.segments.length > 0, true);
  const types = r.assets.map((a) => a.type).sort();
  assert.deepEqual(types, ["flashcards", "notes", "quiz"]);
  assert.equal(r.topics.length > 0, true);
  assert.equal(r.chunks.length, r.topics.length);
});

test("grounding guard drops refs to non-existent segments", () => {
  const segs = new Map<string, TranscriptSegment>([
    ["seg-0", { id: "seg-0", start: 0, end: 1, speaker: null, text: "x", confidence: 0.9 }],
  ]);
  const good = ground({ text: "a", sourceRefs: ["seg-0"] }, segs, 0.75);
  assert.equal(good.ungrounded, false);
  assert.deepEqual(good.sourceRefs, ["seg-0"]);

  const bad = ground({ text: "b", sourceRefs: ["seg-9999"] }, segs, 0.75);
  assert.equal(bad.ungrounded, true);
  assert.equal(bad.sourceRefs.length, 0);
  assert.equal(bad.flagged, true);
});

test("low-confidence far-field segments propagate to flagged statements", () => {
  const segs = new Map<string, TranscriptSegment>([
    ["seg-lo", { id: "seg-lo", start: 0, end: 1, speaker: null, text: "x", confidence: 0.58 }],
  ]);
  const s = ground({ text: "a", sourceRefs: ["seg-lo"] }, segs, 0.75);
  assert.equal(s.flagged, true);
  assert.equal(s.confidence, 0.58);
});

test("quiz never ships an ungrounded question (bogus seg-9999 removed)", async () => {
  const r = await processLecture(input);
  const quiz = r.assets.find((a) => a.type === "quiz")!.content as Quiz;
  for (const q of quiz.questions) {
    assert.equal(q.explanation.sourceRefs.length > 0, true);
  }
});

test("notes points are all grounded to real segment ids", async () => {
  const r = await processLecture(input);
  const notes = r.assets.find((a) => a.type === "notes")!.content as RevisionNotes;
  const realIds = new Set(r.transcript.segments.map((s) => s.id));
  for (const topic of notes.topics) {
    for (const p of topic.points) {
      assert.equal(p.sourceRefs.length > 0, true);
      for (const ref of p.sourceRefs) assert.equal(realIds.has(ref), true);
    }
  }
});

test("RAG returns a relevant, citable hit", async () => {
  const r = await processLecture(input);
  const embeddings = getEmbeddingsProvider();
  const hits = await search(embeddings, r.chunks, "collision resolution strategies", 3);
  assert.equal(hits.length > 0, true);
  // Top hit should mention collisions and carry citation anchors.
  assert.match(hits[0]!.chunk.text.toLowerCase(), /collision|chaining/);
  assert.equal(hits[0]!.chunk.segmentIds.length > 0, true);
});
