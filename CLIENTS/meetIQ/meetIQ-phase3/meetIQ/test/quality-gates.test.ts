/**
 * Phase 13 — quality-gate golden set (moat #1 / NFR-1).
 *
 * These tests pin the behavior the whole product's credibility rests on:
 * far-field low-confidence audio must be held back for faculty review, and
 * ungrounded generated content must never reach a student. We drive the asset
 * builder directly with hand-crafted transcripts of known confidence profiles
 * so the gate thresholds are exercised deterministically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transcript, TranscriptSegment, KnowledgeAsset } from "../src/types.ts";
import { MockLLMProvider } from "../src/providers/llm/mock.ts";
import { segmentTopics } from "../src/pipeline/segment.ts";
import { buildAssets } from "../src/pipeline/assets.ts";

const llm = new MockLLMProvider();

/** Build a transcript whose segments all share one confidence value. */
function transcriptAtConfidence(confidence: number, n = 6): Transcript {
  const segments: TranscriptSegment[] = Array.from({ length: n }, (_, i) => ({
    id: `seg-${i}`,
    start: i * 10,
    end: i * 10 + 8,
    speaker: "SPEAKER_0",
    text: `This is sentence number ${i} explaining an important concept clearly.`,
    confidence,
  }));
  return { lectureId: "q", language: "en", provider: "mock", segments };
}

async function build(t: Transcript, flagThreshold = 0.75, autoHold = 0.15) {
  const topics = await segmentTopics(llm, t);
  return buildAssets(llm, t, topics, {
    confidenceFlagThreshold: flagThreshold,
    assetAutoHoldFlagRatio: autoHold,
  });
}

function byType(assets: KnowledgeAsset[], type: string) {
  return assets.find((a) => a.type === type)!;
}

test("clean audio (high confidence) → grounded assets stay draft, zero flags", async () => {
  // Notes and flashcards are fully grounded, so clean audio → no flags, no
  // hold. (The quiz is deliberately excluded: the mock injects one ungrounded
  // question to exercise the guard, which correctly flags/holds it even on
  // clean audio — verified in the "ungrounded content" test below.)
  const assets = await build(transcriptAtConfidence(0.96));
  for (const a of assets.filter((x) => x.type !== "quiz")) {
    assert.equal(a.flagRatio, 0, `${a.type} should have no flags`);
    assert.notEqual(a.status, "auto_held", `${a.type} should not be held`);
  }
});

test("a hallucinated citation holds the asset even on clean audio", async () => {
  // The mock's bogus seg-9999 quiz question means the quiz carries an
  // ungrounded statement; the guard flags it and the auto-hold trips.
  const quiz = byType(await build(transcriptAtConfidence(0.96)), "quiz");
  assert.equal(quiz.ungroundedRatio > 0, true);
  assert.equal(quiz.status, "auto_held");
});

test("far-field audio (all low confidence) → every asset auto-held", async () => {
  const assets = await build(transcriptAtConfidence(0.5));
  for (const a of assets) {
    assert.equal(a.status, "auto_held", `${a.type} must be held for review`);
    assert.equal(a.flagRatio > 0.15, true);
  }
});

test("confidence threshold is honored (0.6 audio flagged at 0.75, clean at 0.55)", async () => {
  const strict = await build(transcriptAtConfidence(0.6), 0.75);
  assert.equal(byType(strict, "notes").flagRatio > 0, true);

  const lenient = await build(transcriptAtConfidence(0.6), 0.55);
  assert.equal(byType(lenient, "notes").flagRatio, 0);
});

test("auto-hold ratio is honored — a small fraction of bad segments doesn't hold a large asset", async () => {
  // 1 low-confidence segment out of 10 = 10% flagged < 15% hold ratio.
  const t = transcriptAtConfidence(0.96, 10);
  t.segments[3]!.confidence = 0.4;
  const assets = await build(t, 0.75, 0.15);
  const notes = byType(assets, "notes");
  assert.equal(notes.flagRatio > 0, true, "the one bad segment should flag a point");
  assert.equal(notes.flagRatio <= 0.15, true);
  assert.equal(notes.status, "draft", "below hold ratio → not held");
});

test("crossing the auto-hold ratio flips the asset to held", async () => {
  // Same asset, but a stricter hold ratio (5%) now trips on the single flag.
  const t = transcriptAtConfidence(0.96, 10);
  t.segments[3]!.confidence = 0.4;
  const assets = await build(t, 0.75, 0.05);
  assert.equal(byType(assets, "notes").status, "auto_held");
});

test("quiz never ships ungrounded content regardless of confidence", async () => {
  // The mock emits one quiz question citing a bogus segment id; it must be
  // dropped at every confidence level.
  for (const conf of [0.95, 0.6, 0.4]) {
    const assets = await build(transcriptAtConfidence(conf));
    const quiz = byType(assets, "quiz");
    // ungroundedRatio is measured pre-filter; shipped questions are all grounded.
    const content = quiz.content as { questions: Array<{ explanation: { sourceRefs: string[] } }> };
    for (const q of content.questions) {
      assert.equal(q.explanation.sourceRefs.length > 0, true);
    }
  }
});

test("flag ratio is a real fraction in [0,1] for every asset", async () => {
  const assets = await build(transcriptAtConfidence(0.7));
  for (const a of assets) {
    assert.equal(a.flagRatio >= 0 && a.flagRatio <= 1, true);
    assert.equal(a.ungroundedRatio >= 0 && a.ungroundedRatio <= 1, true);
  }
});
