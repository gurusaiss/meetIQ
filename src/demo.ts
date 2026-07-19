/**
 * End-to-end demo of the value engine. Runs with zero API keys/infra
 * (mock providers). Shows: transcription → topics → grounded assets with
 * confidence flags + auto-hold → hallucination guard → RAG search.
 *
 *   npm run demo
 */
import { processLecture } from "./pipeline/pipeline.ts";
import { search } from "./pipeline/rag.ts";
import { getEmbeddingsProvider } from "./providers/embeddings/index.ts";
import { config } from "./config.ts";
import type { RevisionNotes, Quiz } from "./types.ts";

function hr(label: string) {
  console.log("\n" + "─".repeat(64) + `\n${label}\n` + "─".repeat(64));
}

const result = await processLecture({
  lectureId: "lec-demo-001",
  mediaRef: "sample-data/lecture-hash-tables.mp4",
  diarize: true,
  speakerHints: { SPEAKER_0: "Prof. Anika", SPEAKER_1: "Student" },
});

hr(`TRANSCRIPT (provider=${result.transcript.provider})`);
console.log(`${result.transcript.segments.length} segments, language=${result.transcript.language}`);
const lowConf = result.transcript.segments.filter(
  (s) => s.confidence < config.quality.confidenceFlagThreshold,
);
console.log(
  `Low-confidence (far-field) segments flagged: ${lowConf.map((s) => s.id).join(", ")}`,
);

hr("TOPICS");
for (const t of result.topics) {
  const risk = t.minConfidence < config.quality.confidenceFlagThreshold ? "  ⚠ low-confidence audio" : "";
  console.log(`• ${t.title}  [${t.segmentIds.length} segs]${risk}`);
}

hr("ASSETS (with quality gate)");
for (const a of result.assets) {
  console.log(
    `• ${a.type.padEnd(10)} status=${a.status.padEnd(9)} ` +
      `flagged=${(a.flagRatio * 100).toFixed(0)}%  ungrounded=${(a.ungroundedRatio * 100).toFixed(0)}%`,
  );
}

hr("REVISION NOTES (sample)");
const notes = result.assets.find((a) => a.type === "notes")!.content as RevisionNotes;
for (const topic of notes.topics.slice(0, 2)) {
  console.log(`\n## ${topic.title}  (@${topic.start.toFixed(0)}s)`);
  for (const p of topic.points) {
    const flag = p.flagged ? " ⚠" : "";
    console.log(`  - ${p.text}  [${p.sourceRefs.join(",")}]${flag}`);
  }
}

hr("HALLUCINATION GUARD");
const quiz = result.assets.find((a) => a.type === "quiz")!.content as Quiz;
console.log(
  `Quiz kept ${quiz.questions.length} questions. The mock emitted a question ` +
    `citing a non-existent segment (seg-9999); the grounding guard dropped it ` +
    `so it never reaches a student.`,
);

hr("RAG — chat with the course");
const embeddings = getEmbeddingsProvider();
for (const query of [
  "How are collisions handled?",
  "What is the time complexity of a lookup?",
]) {
  const hits = await search(embeddings, result.chunks, query, 1);
  const top = hits[0];
  console.log(`\nQ: ${query}`);
  if (top) {
    console.log(
      `A: ${top.chunk.text.slice(0, 120)}...\n   (cite: ${top.chunk.segmentIds.join(",")} @ ${top.chunk.start.toFixed(0)}s, score=${top.score.toFixed(2)})`,
    );
  } else {
    console.log("A: (no match)");
  }
}

console.log("\n✅ Pipeline complete.\n");
