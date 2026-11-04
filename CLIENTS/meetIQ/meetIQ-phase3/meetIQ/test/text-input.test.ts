import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processLecture } from "../src/pipeline/pipeline.ts";
import { splitIntoSegments } from "../src/providers/transcription/text.ts";

const TEXT = `Photosynthesis converts light energy into chemical energy. It happens in the chloroplasts.

The light reactions produce ATP and NADPH. The Calvin cycle then uses them to fix carbon dioxide into sugar.
Plants therefore store solar energy as glucose!`;

test("text is split into sentence segments with full confidence", () => {
  const segs = splitIntoSegments(TEXT);
  assert.equal(segs.length, 5);
  assert.deepEqual(segs.map((s) => s.id), ["seg-0", "seg-1", "seg-2", "seg-3", "seg-4"]);
  assert.ok(segs.every((s) => s.confidence === 1 && s.end > s.start));
  assert.ok(segs[1]!.start >= segs[0]!.end - 0.001, "positions are monotonic");
});

test("a text:// mediaRef runs the pipeline on the text, not the audio fixture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lip-text-"));
  const path = join(dir, "notes.txt");
  writeFileSync(path, TEXT);
  const r = await processLecture({ lectureId: "txt-1", mediaRef: `text://${path}` });
  assert.equal(r.transcript.provider, "text");
  assert.equal(r.transcript.segments.length, 5);
  assert.ok(r.chunks.length > 0);
});

test("empty text is rejected with a clear error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lip-text-"));
  const path = join(dir, "empty.txt");
  writeFileSync(path, "   \n ");
  await assert.rejects(
    processLecture({ lectureId: "txt-2", mediaRef: `text://${path}` }),
    /empty/i,
  );
});
