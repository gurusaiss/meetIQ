import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoomCaptureSource, getCaptureSource } from "../src/integrations/capture.ts";
import { SlackLmsConnector, getLmsConnector } from "../src/integrations/lms.ts";
import type { LmsItem } from "../src/integrations/lms.ts";

/** Minimal fetch stub: a queue of responses, and a record of every call made. */
function fetchStub(responses: Array<{ status: number; json?: unknown; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

// ── Zoom capture source ────────────────────────────────────────────

test("Zoom: refuses to construct without full credentials", () => {
  assert.throws(() => new ZoomCaptureSource({ accountId: "", clientId: "x", clientSecret: "y" }));
  assert.throws(() => new ZoomCaptureSource({ accountId: "a", clientId: "", clientSecret: "y" }));
  assert.throws(() => new ZoomCaptureSource({ accountId: "a", clientId: "x", clientSecret: "" }));
});

test("Zoom: fetches an OAuth token, then lists recordings, mapping to ExternalRecording", async () => {
  const { impl, calls } = fetchStub([
    { status: 200, json: { access_token: "tok-123", expires_in: 3600 } },
    {
      status: 200,
      json: {
        meetings: [
          {
            id: 999,
            topic: "Weekly sync",
            start_time: "2026-02-01T10:00:00Z",
            duration: 30,
            recording_files: [
              { id: "f1", file_type: "MP4", download_url: "https://zoom.us/rec/f1", recording_type: "shared_screen_with_speaker_view" },
              { id: "f2", file_type: "M4A", download_url: "https://zoom.us/rec/f2", recording_type: "audio_only" },
            ],
          },
        ],
      },
    },
  ]);
  const source = new ZoomCaptureSource({ accountId: "acc", clientId: "id", clientSecret: "secret" }, impl);
  const recs = await source.listRecordings("me");

  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /^https:\/\/zoom\.us\/oauth\/token\?grant_type=account_credentials&account_id=acc$/);
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
  assert.match(calls[1]!.url, /^https:\/\/api\.zoom\.us\/v2\/users\/me\/recordings/);
  assert.equal((calls[1]!.init?.headers as Record<string, string>).authorization, "Bearer tok-123");

  assert.equal(recs.length, 1);
  assert.equal(recs[0]!.title, "Weekly sync");
  assert.equal(recs[0]!.durationSec, 30 * 60);
  assert.equal(recs[0]!.consentCaptured, false);
  // Picks the shared_screen_with_speaker_view MP4, not the audio-only file.
  assert.match(recs[0]!.mediaRef, /^https:\/\/zoom\.us\/rec\/f1\?access_token=tok-123$/);
});

test("Zoom: caches the access token across calls instead of re-authenticating every time", async () => {
  const { impl, calls } = fetchStub([
    { status: 200, json: { access_token: "tok-abc", expires_in: 3600 } },
    { status: 200, json: { meetings: [] } },
    { status: 200, json: { meetings: [] } },
  ]);
  const source = new ZoomCaptureSource({ accountId: "acc", clientId: "id", clientSecret: "secret" }, impl);
  await source.listRecordings("me");
  await source.listRecordings("me");
  // One token fetch, two recordings fetches — not two token fetches.
  assert.equal(calls.filter((c) => c.url.includes("oauth/token")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("/recordings")).length, 2);
});

test("Zoom: a failed token request throws a clear error, not a raw parse failure", async () => {
  const { impl } = fetchStub([{ status: 401, text: "invalid_client" }]);
  const source = new ZoomCaptureSource({ accountId: "acc", clientId: "id", clientSecret: "wrong" }, impl);
  await assert.rejects(() => source.listRecordings("me"), /Zoom OAuth token request failed: 401/);
});

test("getCaptureSource('zoom') requires credentials to be supplied", () => {
  assert.throws(() => getCaptureSource("zoom"), /no credentials/);
  const source = getCaptureSource("zoom", { accountId: "a", clientId: "b", clientSecret: "c" });
  assert.equal(source.name, "zoom");
});

// ── Slack LMS connector ─────────────────────────────────────────────

const ITEM: LmsItem = {
  lectureId: "lec-1",
  type: "actions",
  title: "lec-1 — Decisions & Action Items",
  body: "- Decided: ship it",
  contentType: "text/markdown",
};

test("Slack: refuses to construct without a webhook URL", () => {
  assert.throws(() => new SlackLmsConnector({ webhookUrl: "" }));
});

test("Slack: posts one message per item to the webhook and tracks what was published", async () => {
  const { impl, calls } = fetchStub([{ status: 200, text: "ok" }, { status: 200, text: "ok" }]);
  const slack = new SlackLmsConnector({ webhookUrl: "https://hooks.slack.com/services/x" }, impl);
  const count = await slack.publish("acme-weekly", [ITEM, { ...ITEM, type: "notes", title: "lec-1 — Notes" }]);

  assert.equal(count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, "https://hooks.slack.com/services/x");
  const body = JSON.parse(calls[0]!.init!.body as string);
  assert.match(body.text, /Decisions & Action Items/);
  assert.match(body.text, /Decided: ship it/);
  assert.equal(slack.published.length, 2);
  assert.equal(slack.published[0]!.externalCourseId, "acme-weekly");
});

test("Slack: a webhook rejection throws, and does not count as published", async () => {
  const { impl } = fetchStub([{ status: 400, text: "invalid_payload" }]);
  const slack = new SlackLmsConnector({ webhookUrl: "https://hooks.slack.com/services/x" }, impl);
  await assert.rejects(() => slack.publish("acme-weekly", [ITEM]), /Slack webhook rejected/);
  assert.equal(slack.published.length, 0);
});

test("Slack: truncates an oversized body instead of sending an over-limit message", async () => {
  const { impl, calls } = fetchStub([{ status: 200 }]);
  const slack = new SlackLmsConnector({ webhookUrl: "https://hooks.slack.com/services/x" }, impl);
  const huge = { ...ITEM, body: "x".repeat(5000) };
  await slack.publish("acme-weekly", [huge]);
  const body = JSON.parse(calls[0]!.init!.body as string);
  assert.equal(body.text.length < 3200, true);
  assert.match(body.text, /truncated/);
});

test("getLmsConnector('slack') requires credentials to be supplied", () => {
  assert.throws(() => getLmsConnector("slack"), /no credentials/);
  const slack = getLmsConnector("slack", { webhookUrl: "https://hooks.slack.com/services/x" });
  assert.equal(slack.name, "slack");
});
