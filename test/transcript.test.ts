import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  AuthorizationError,
  NotFoundError,
  type Actor,
} from "../src/services/lecture-service.ts";
import { transcriptToSrt, transcriptToVtt, transcriptToText } from "../src/export/exporters.ts";
import type { Transcript } from "../src/types.ts";
import type { Institution, Course } from "../src/persistence/repository.ts";

const T: Transcript = {
  lectureId: "lec-1",
  language: "en",
  provider: "mock",
  segments: [
    { id: "seg-1", start: 0, end: 4.5, speaker: "Prof. Rao", text: "Welcome to hash tables.", confidence: 0.95 },
    { id: "seg-2", start: 4.5, end: 9.25, speaker: null, text: "Collisions & chaining <matter>.", confidence: 0.5 },
  ],
};

// ── caption formats ─────────────────────────────────────────────────

test("SRT: numbered cues, comma milliseconds, speaker prefix, blank line between cues", () => {
  assert.equal(
    transcriptToSrt(T),
    "1\n00:00:00,000 --> 00:00:04,500\nProf. Rao: Welcome to hash tables.\n\n" +
      "2\n00:00:04,500 --> 00:00:09,250\nCollisions & chaining <matter>.\n",
  );
});

test("VTT: WEBVTT header, dot milliseconds, voice tag, markup characters escaped", () => {
  assert.equal(
    transcriptToVtt(T),
    "WEBVTT\n\n" +
      "00:00:00.000 --> 00:00:04.500\n<v Prof. Rao>Welcome to hash tables.\n\n" +
      "00:00:04.500 --> 00:00:09.250\nCollisions &amp; chaining &lt;matter>.\n",
  );
});

test("VTT: a '-->' inside speech cannot break the cue, and a speaker label cannot inject a tag", () => {
  const vtt = transcriptToVtt({
    ...T,
    segments: [{ id: "s", start: 0, end: 2, speaker: "A<b>", text: "go --> there", confidence: 1 }],
  });
  assert.equal((vtt.match(/-->/g) ?? []).length, 1, "only the timing arrow remains");
  assert.match(vtt, /go --&gt; there/);
  assert.equal(vtt.includes("<b>"), false);
});

test("captions: timestamps past an hour, zero-length cues, and multi-line text are all valid", () => {
  const t: Transcript = {
    ...T,
    segments: [
      { id: "a", start: 3723.5, end: 3723.5, speaker: null, text: "line one\n\nline two", confidence: 1 },
    ],
  };
  const srt = transcriptToSrt(t);
  assert.match(srt, /01:02:03,500 --> 01:02:04,500/, "a cue that would end where it starts is given a duration");
  assert.match(srt, /line one line two/, "a blank line inside a cue would end it early");
  assert.equal(srt.split("\n\n").length, 1, "exactly one cue, no stray blank line inside it");
});

test("plain text: timestamped, and low-confidence segments are marked rather than silently trusted", () => {
  const txt = transcriptToText("lec-1", T, 0.75);
  assert.match(txt, /^lec-1 — Transcript\n\n/);
  assert.match(txt, /\[00:00:00\] Prof\. Rao: Welcome to hash tables\.\n/);
  assert.match(txt, /\[00:00:04\] Collisions & chaining <matter>\.  \[low confidence/);
  assert.equal(/Welcome to hash tables\.  \[low/.test(txt), false, "clear audio is not flagged");
});

// ── access gate ─────────────────────────────────────────────────────

const INST: Institution = { id: "inst-a", name: "State U", consentPolicy: "all_party", dataRegion: "us-east", retentionDays: 365 };
const COURSE: Course = { id: "c1", institutionId: "inst-a", code: "CS101", title: "DS" };
const FACULTY: Actor = { id: "fay", role: "faculty" };
const TA: Actor = { id: "tia", role: "ta" };
const STUDENT: Actor = { id: "sam", role: "student" };
const AUDITOR: Actor = { id: "audie", role: "auditor" };

async function setup(process = true) {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  await service.seedInstitution(INST, COURSE);
  await service.createLecture({
    institutionId: "inst-a", courseId: "c1", lectureId: "lec-1",
    mediaRef: "media://x", captureSource: "upload", consent: { noticeShown: true },
  });
  const assets = process ? await service.processLecture("inst-a", "lec-1", { diarize: true }) : [];
  return { repo, service, assets };
}

test("staff can read the transcript before anything is approved; students cannot", async () => {
  const { service } = await setup();
  for (const staff of [FACULTY, TA, { id: "root", role: "admin" } as Actor]) {
    const t = await service.getTranscript("inst-a", "lec-1", staff);
    assert.equal(t.segments.length > 0, true);
  }
  await assert.rejects(() => service.getTranscript("inst-a", "lec-1", STUDENT), AuthorizationError);
  await assert.rejects(() => service.getTranscript("inst-a", "lec-1", AUDITOR), AuthorizationError);
});

test("once faculty approves any asset, students and auditors can read the transcript", async () => {
  const { service, assets } = await setup();
  await service.approveAsset("inst-a", assets[0]!.id, FACULTY);
  assert.ok(await service.getTranscript("inst-a", "lec-1", STUDENT));
  assert.ok(await service.getTranscript("inst-a", "lec-1", AUDITOR));
});

test("a lecture with no transcript yet, or no such lecture, is NotFound (not a permissions error)", async () => {
  const { service } = await setup(false);
  await assert.rejects(() => service.getTranscript("inst-a", "lec-1", FACULTY), NotFoundError);
  await assert.rejects(() => service.getTranscript("inst-a", "nope", FACULTY), NotFoundError);
});

test("another organisation cannot read the transcript, even as admin", async () => {
  const { service } = await setup();
  await assert.rejects(
    () => service.getTranscript("inst-b", "lec-1", { id: "x", role: "admin" }),
    NotFoundError,
  );
});

test("exporting a transcript is audited; merely viewing it is not", async () => {
  const { service, repo } = await setup();
  await service.getTranscript("inst-a", "lec-1", FACULTY, "view");
  assert.equal((await repo.listAudit("inst-a")).some((e) => e.action === "transcript.exported"), false);

  await service.getTranscript("inst-a", "lec-1", FACULTY, "export");
  const ev = (await repo.listAudit("inst-a")).find((e) => e.action === "transcript.exported");
  assert.ok(ev);
  assert.equal(ev!.actor, "fay");
  assert.equal(ev!.target, "lec-1");
});

test("a blocked export is not audited as an export", async () => {
  const { service, repo } = await setup();
  await assert.rejects(() => service.getTranscript("inst-a", "lec-1", STUDENT, "export"), AuthorizationError);
  assert.equal((await repo.listAudit("inst-a")).some((e) => e.action === "transcript.exported"), false);
});
