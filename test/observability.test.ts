import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLog } from "../src/observability/logger.ts";
import { validateConfig, type Config } from "../src/config.ts";
import { SqliteRepository } from "../src/persistence/sqlite.ts";

test("formatLog emits a single-line JSON record with fields merged", () => {
  const line = formatLog("info", "request", { path: "/", status: 200 }, "2026-07-19T00:00:00.000Z");
  assert.equal(line.includes("\n"), false);
  const rec = JSON.parse(line);
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "request");
  assert.equal(rec.path, "/");
  assert.equal(rec.status, 200);
  assert.equal(rec.ts, "2026-07-19T00:00:00.000Z");
});

function cfg(over: Partial<Config["providers"]>, quality?: Partial<Config["quality"]>): Config {
  return {
    providers: { transcription: "mock", llm: "mock", embeddings: "mock", ...over },
    llmModel: "claude-sonnet-5",
    keys: { assemblyai: "", deepgram: "", anthropic: "" },
    quality: { confidenceFlagThreshold: 0.75, assetAutoHoldFlagRatio: 0.15, ...quality },
  } as Config;
}

test("validateConfig passes on the default mock config", () => {
  assert.deepEqual(validateConfig(cfg({})), []);
});

test("validateConfig rejects unknown providers", () => {
  const errs = validateConfig(cfg({ transcription: "whisperx" as never }));
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /TRANSCRIPTION_PROVIDER/);
});

test("validateConfig rejects out-of-range thresholds", () => {
  const errs = validateConfig(cfg({}, { confidenceFlagThreshold: 1.5 }));
  assert.equal(errs.some((e) => /CONFIDENCE_FLAG_THRESHOLD/.test(e)), true);
});

test("validateConfig requires a key when a real provider is selected", () => {
  const errs = validateConfig(cfg({ llm: "anthropic" }));
  assert.equal(errs.some((e) => /ANTHROPIC_API_KEY/.test(e)), true);
});

test("repository healthcheck returns true for a live store", () => {
  const repo = new SqliteRepository(":memory:");
  assert.equal(repo.healthcheck(), true);
  repo.close();
});
