import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  AuthorizationError,
  ComplianceError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../src/services/lecture-service.ts";
import { auditToCsv, auditToJson } from "../src/export/exporters.ts";
import type { Institution, Course } from "../src/persistence/repository.ts";

const INST: Institution = { id: "inst-a", name: "Rao & Partners", consentPolicy: "all_party", dataRegion: "us-east", retentionDays: 30 };
const COURSE: Course = { id: "c1", institutionId: "inst-a", code: "M1", title: "Matters" };
const PARTNER: Actor = { id: "pat", role: "admin" };
const ASSOCIATE: Actor = { id: "alex", role: "faculty" };
const TA: Actor = { id: "tia", role: "ta" };
const CLIENT: Actor = { id: "cleo", role: "student" };
const AUDITOR: Actor = { id: "audie", role: "auditor" };

async function setup(file = ":memory:") {
  const repo = new SqliteRepository(file);
  const service = new LectureService(repo);
  await service.seedInstitution(INST, COURSE);
  return { repo, service };
}
async function depo(service: LectureService, id = "depo-1", process = true) {
  await service.createLecture({
    institutionId: "inst-a", courseId: "c1", lectureId: id,
    mediaRef: "media://x", captureSource: "upload", consent: { noticeShown: true },
  });
  return process ? service.processLecture("inst-a", id, { diarize: true }) : [];
}

// ── legal hold ──────────────────────────────────────────────────────

test("staff can place a hold; clients and auditors cannot; it needs a reason", async () => {
  const { service, repo } = await setup();
  await depo(service);
  await assert.rejects(() => service.placeLegalHold("inst-a", "depo-1", "Smith v. Jones", CLIENT), AuthorizationError);
  await assert.rejects(() => service.placeLegalHold("inst-a", "depo-1", "Smith v. Jones", AUDITOR), AuthorizationError);
  await assert.rejects(() => service.placeLegalHold("inst-a", "depo-1", "   ", ASSOCIATE), ValidationError);
  await assert.rejects(() => service.placeLegalHold("inst-a", "depo-1", "x".repeat(301), ASSOCIATE), ValidationError);
  await assert.rejects(() => service.placeLegalHold("inst-a", "nope", "Smith v. Jones", ASSOCIATE), NotFoundError);

  await service.placeLegalHold("inst-a", "depo-1", "  Smith v. Jones,   No. 24-1138 ", ASSOCIATE);
  const hold = (await repo.getLecture("inst-a", "depo-1"))?.hold;
  assert.equal(hold?.reason, "Smith v. Jones, No. 24-1138", "whitespace is normalised");
  assert.equal(hold?.by, "alex");
  await assert.rejects(() => service.placeLegalHold("inst-a", "depo-1", "again", TA), ConflictError);
});

test("a held lecture cannot be deleted, by anyone, until an admin releases the hold", async () => {
  const { service, repo } = await setup();
  await depo(service);
  await service.placeLegalHold("inst-a", "depo-1", "Preserve: Smith v. Jones", ASSOCIATE);

  for (const who of [ASSOCIATE, TA, PARTNER]) {
    await assert.rejects(() => service.deleteLecture("inst-a", "depo-1", who), ComplianceError, who.role);
  }
  assert.ok(await repo.getLecture("inst-a", "depo-1"), "still there");
  assert.ok(await repo.getTranscript("inst-a", "depo-1"), "and its transcript");

  // Only an admin may lift the order.
  await assert.rejects(() => service.releaseLegalHold("inst-a", "depo-1", ASSOCIATE), AuthorizationError);
  await assert.rejects(() => service.releaseLegalHold("inst-a", "depo-1", TA), AuthorizationError);
  await service.releaseLegalHold("inst-a", "depo-1", PARTNER);
  assert.equal((await repo.getLecture("inst-a", "depo-1"))?.hold, undefined);
  await assert.rejects(() => service.releaseLegalHold("inst-a", "depo-1", PARTNER), ConflictError, "not on hold any more");

  await service.deleteLecture("inst-a", "depo-1", ASSOCIATE);
  assert.equal(await repo.getLecture("inst-a", "depo-1"), null);
});

test("retention purges old lectures but never one under legal hold, and says so", async () => {
  const { service, repo } = await setup();
  await depo(service, "held-1");
  await depo(service, "old-1");
  await service.placeLegalHold("inst-a", "held-1", "Matter 7", ASSOCIATE);

  // Nothing is past the 30-day policy yet.
  assert.deepEqual(await service.runRetentionDetailed("inst-a", PARTNER), { purged: 0, heldSkipped: 0 });

  // 45 days on, both are past it; only the unheld one may go.
  const later = new Date(Date.now() + 45 * 86_400_000);
  assert.deepEqual(await service.runRetentionDetailed("inst-a", PARTNER, later), { purged: 1, heldSkipped: 1 });
  assert.ok(await repo.getLecture("inst-a", "held-1"), "the held one survives retention");
  assert.ok(await repo.getTranscript("inst-a", "held-1"), "with its transcript");
  assert.equal(await repo.getLecture("inst-a", "old-1"), null);

  const actions = (await repo.listAudit("inst-a")).map((e) => e.action);
  assert.ok(actions.includes("retention.skipped_legal_hold"));
  assert.ok(actions.includes("lecture.purged"));

  assert.equal(await service.runRetention("inst-a", PARTNER, later), 0, "the numeric wrapper still works (and the hold still holds)");
  assert.ok(await repo.getLecture("inst-a", "held-1"));
  await assert.rejects(() => service.runRetentionDetailed("inst-a", ASSOCIATE, later), AuthorizationError);

  // Once released, the next retention run takes it.
  await service.releaseLegalHold("inst-a", "held-1", PARTNER);
  assert.deepEqual(await service.runRetentionDetailed("inst-a", PARTNER, later), { purged: 1, heldSkipped: 0 });
});

test("placing and releasing a hold are audited, with the reason kept in the trail", async () => {
  const { service, repo } = await setup();
  await depo(service);
  await service.placeLegalHold("inst-a", "depo-1", "Smith v. Jones", ASSOCIATE);
  await service.releaseLegalHold("inst-a", "depo-1", PARTNER);
  const events = await repo.listAudit("inst-a");
  const placed = events.find((e) => e.action === "legal_hold.placed")!;
  assert.equal(placed.actor, "alex");
  assert.equal(placed.target, "depo-1: Smith v. Jones", "the reason survives even after the hold is released");
  const released = events.find((e) => e.action === "legal_hold.released")!;
  assert.equal(released.actor, "pat");
});

test("a hold in one organisation does not touch another's lecture of a different id", async () => {
  const { service, repo } = await setup();
  await service.seedInstitution({ ...INST, id: "inst-b" }, { ...COURSE, id: "c2", institutionId: "inst-b" });
  await depo(service);
  await assert.rejects(() => service.placeLegalHold("inst-b", "depo-1", "cross-tenant", { id: "x", role: "admin" }), NotFoundError);
  assert.equal((await repo.getLecture("inst-a", "depo-1"))?.hold, undefined);
});

// ── audit trail ─────────────────────────────────────────────────────

test("only admins and auditors can read the audit trail, and a normal one verifies", async () => {
  const { service } = await setup();
  const assets = await depo(service);
  await service.approveAsset("inst-a", assets[0]!.id, ASSOCIATE);

  for (const who of [ASSOCIATE, TA, CLIENT]) {
    await assert.rejects(() => service.auditTrail("inst-a", who), AuthorizationError, who.role);
  }
  for (const who of [PARTNER, AUDITOR]) {
    const { events, verification } = await service.auditTrail("inst-a", who);
    assert.equal(events.length > 3, true);
    assert.equal(verification.ok, true);
    assert.equal(verification.chained, events.length);
    assert.equal(verification.head, events[events.length - 1]!.hash);
  }
});

test("rewriting history in the database makes the audit trail report itself broken", async () => {
  const file = join(tmpdir(), `lip-legal-${process.pid}-${Date.now()}.sqlite`);
  try {
    const { service } = await setup(file);
    await depo(service);
    assert.equal((await service.auditTrail("inst-a", AUDITOR)).verification.ok, true);

    const raw = new DatabaseSync(file);
    raw.prepare(`UPDATE audit SET actor='someone-else' WHERE action='lecture.created'`).run();
    raw.close();

    const { verification } = await service.auditTrail("inst-a", AUDITOR);
    assert.equal(verification.ok, false);
    assert.match(verification.reason ?? "", /altered|contents/);
  } finally {
    rmSync(file, { force: true });
  }
});

test("exporting the audit trail is itself audited, after the snapshot (so the export does not contain itself)", async () => {
  const { service } = await setup();
  await depo(service);
  const snap = await service.exportAuditTrail("inst-a", AUDITOR);
  assert.equal(snap.events.some((e) => e.action === "audit.exported"), false);
  const after = await service.auditTrail("inst-a", PARTNER);
  const ev = after.events.find((e) => e.action === "audit.exported")!;
  assert.equal(ev.actor, "audie");
  assert.equal(after.verification.ok, true);
  await assert.rejects(() => service.exportAuditTrail("inst-a", ASSOCIATE), AuthorizationError);
});

test("the CSV export neutralises spreadsheet formulas, and carries the hashes and verdict", async () => {
  const { service } = await setup();
  await depo(service);
  const { events, verification } = await service.auditTrail("inst-a", PARTNER);
  const hostile = [{ ...events[0]!, actor: '=HYPERLINK("http://evil","x")', target: "+1+1" }];
  const csv = auditToCsv(hostile, verification);
  assert.match(csv, /'=HYPERLINK\(""http:\/\/evil"",""x""\)/, "a leading = is defused with a quote");
  assert.match(csv, /'\+1\+1/);
  assert.match(csv.split("\n")[0]!, /^# audit chain: /, "the verdict is the first line");
  assert.match(csv, /seq,ts,actor,action,target,prev_hash,hash/);

  const json = JSON.parse(auditToJson(events, verification));
  assert.equal(json.verification.ok, true);
  assert.equal(json.events.length, events.length);
  assert.equal(json.head, verification.head);
});

// ── transcript fingerprint ──────────────────────────────────────────

test("processing records a transcript fingerprint; it matches until the transcript is altered", async () => {
  const { service, repo } = await setup();
  await depo(service);

  const ok = await service.verifyTranscriptIntegrity("inst-a", "depo-1", ASSOCIATE);
  assert.equal(ok.status, "match");
  assert.equal(ok.auditChainOk, true);
  assert.equal(ok.recorded, ok.current);

  // Someone edits a word of the stored transcript.
  const t = (await repo.getTranscript("inst-a", "depo-1"))!;
  t.segments[0] = { ...t.segments[0]!, text: t.segments[0]!.text + " (edited)" };
  await repo.saveTranscript("inst-a", t);

  const bad = await service.verifyTranscriptIntegrity("inst-a", "depo-1", ASSOCIATE);
  assert.equal(bad.status, "mismatch");
  assert.notEqual(bad.recorded, bad.current);
  assert.equal(bad.auditChainOk, true, "the record itself is intact; it's the transcript that changed");
});

test("a transcript with no recorded fingerprint (processed before this release) is reported as such, not as a match", async () => {
  const { service, repo } = await setup();
  await depo(service, "old-depo", false);
  await repo.saveTranscript("inst-a", { lectureId: "old-depo", language: "en", provider: "mock", segments: [{ id: "s1", start: 0, end: 1, speaker: null, text: "hi", confidence: 1 }] });
  const r = await service.verifyTranscriptIntegrity("inst-a", "old-depo", ASSOCIATE);
  assert.equal(r.status, "no_record");
});

test("the integrity check respects the same release rule as viewing the transcript", async () => {
  const { service } = await setup();
  await depo(service);
  await assert.rejects(() => service.verifyTranscriptIntegrity("inst-a", "depo-1", CLIENT), AuthorizationError);
});
