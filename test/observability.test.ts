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
    repository: { driver: "sqlite", databaseUrl: "", vectorDim: 256 },
    queue: { concurrency: 2 },
    integrations: {
      capture: "mock",
      lms: "mock",
      zoom: { accountId: "", clientId: "", clientSecret: "" },
      slack: { webhookUrl: "" },
    },
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

test("validateConfig rejects an unknown REPO_DRIVER", () => {
  const c = cfg({});
  const errs = validateConfig({ ...c, repository: { ...c.repository, driver: "mongo" } });
  assert.equal(errs.some((e) => /REPO_DRIVER/.test(e)), true);
});

test("validateConfig requires DATABASE_URL when REPO_DRIVER=postgres", () => {
  const c = cfg({});
  const errs = validateConfig({ ...c, repository: { ...c.repository, driver: "postgres" } });
  assert.equal(errs.some((e) => /DATABASE_URL/.test(e)), true);
});

test("validateConfig rejects a non-positive QUEUE_CONCURRENCY", () => {
  const c = cfg({});
  const errs = validateConfig({ ...c, queue: { concurrency: 0 } });
  assert.equal(errs.some((e) => /QUEUE_CONCURRENCY/.test(e)), true);
});

test("validateConfig rejects an unknown CAPTURE_SOURCE / LMS_CONNECTOR", () => {
  const c = cfg({});
  const errs = validateConfig({
    ...c,
    integrations: { ...c.integrations, capture: "mediasite" as never, lms: "d2l" as never },
  });
  assert.equal(errs.some((e) => /CAPTURE_SOURCE/.test(e)), true);
  assert.equal(errs.some((e) => /LMS_CONNECTOR/.test(e)), true);
});

test("validateConfig requires Zoom credentials when CAPTURE_SOURCE=zoom", () => {
  const c = cfg({});
  const errs = validateConfig({ ...c, integrations: { ...c.integrations, capture: "zoom" } });
  assert.equal(errs.some((e) => /ZOOM_ACCOUNT_ID/.test(e)), true);

  const ok = validateConfig({
    ...c,
    integrations: {
      ...c.integrations,
      capture: "zoom",
      zoom: { accountId: "acc", clientId: "id", clientSecret: "secret" },
    },
  });
  assert.equal(ok.some((e) => /ZOOM/.test(e)), false);
});

test("validateConfig requires a webhook URL when LMS_CONNECTOR=slack", () => {
  const c = cfg({});
  const errs = validateConfig({ ...c, integrations: { ...c.integrations, lms: "slack" } });
  assert.equal(errs.some((e) => /SLACK_WEBHOOK_URL/.test(e)), true);

  const ok = validateConfig({
    ...c,
    integrations: { ...c.integrations, lms: "slack", slack: { webhookUrl: "https://hooks.slack.com/x" } },
  });
  assert.equal(ok.some((e) => /SLACK/.test(e)), false);
});

test("repository healthcheck returns true for a live store", async () => {
  const repo = new SqliteRepository(":memory:");
  assert.equal(await repo.healthcheck(), true);
  await repo.close();
});
