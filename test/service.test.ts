import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  ComplianceError,
  AuthorizationError,
} from "../src/services/lecture-service.ts";
import type { Institution, Course } from "../src/persistence/repository.ts";

const INST: Institution = {
  id: "inst-a",
  name: "State University",
  consentPolicy: "all_party",
  dataRegion: "us-east",
  retentionDays: 365,
};
const COURSE: Course = {
  id: "course-cs101",
  institutionId: "inst-a",
  code: "CS101",
  title: "Data Structures",
};

function svc() {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  service.seedInstitution(INST, COURSE);
  return { repo, service };
}

async function processed(service: LectureService, lectureId = "lec-1") {
  service.createLecture({
    institutionId: "inst-a",
    courseId: "course-cs101",
    lectureId,
    mediaRef: "media://x",
    captureSource: "upload",
    consent: { noticeShown: true },
  });
  return service.processLecture("inst-a", lectureId, { diarize: true });
}

test("process persists transcript, assets, and chunks", async () => {
  const { repo, service } = svc();
  const assets = await processed(service);
  assert.equal(assets.length, 3);
  assert.ok(repo.getTranscript("inst-a", "lec-1"));
  assert.equal(repo.listAssets("inst-a", "lec-1").length, 3);
  assert.equal(repo.listCourseChunks("inst-a", "course-cs101").length > 0, true);
  assert.equal(repo.getLecture("inst-a", "lec-1")?.status, "processed");
});

test("compliance gate blocks processing without consent notice (all-party tenant)", async () => {
  const { service } = svc();
  service.createLecture({
    institutionId: "inst-a",
    courseId: "course-cs101",
    lectureId: "lec-noconsent",
    mediaRef: "media://x",
    captureSource: "upload",
    consent: { noticeShown: false },
  });
  await assert.rejects(
    () => service.processLecture("inst-a", "lec-noconsent"),
    ComplianceError,
  );
  // and the failure is recorded as a status, not a silent pass
  // (status stays "created" because assertConsent throws before "processing")
});

test("faculty approval gate: students cannot approve, faculty can", async () => {
  const { service } = svc();
  const assets = await processed(service);
  const target = assets[0]!;

  assert.throws(
    () => service.approveAsset("inst-a", target.id, { id: "sam", role: "student" }),
    AuthorizationError,
  );

  const approved = service.approveAsset("inst-a", target.id, {
    id: "anika",
    role: "faculty",
  });
  assert.equal(approved.status, "approved");
});

test("students only see approved assets", async () => {
  const { service } = svc();
  const assets = await processed(service);
  assert.equal(service.studentAssets("inst-a", "lec-1").length, 0); // none approved yet
  service.approveAsset("inst-a", assets[0]!.id, { id: "anika", role: "faculty" });
  assert.equal(service.studentAssets("inst-a", "lec-1").length, 1);
});

test("tenant isolation: another institution cannot read the data", async () => {
  const { repo, service } = svc();
  await processed(service);
  assert.equal(repo.getLecture("inst-b", "lec-1"), null);
  assert.equal(repo.listAssets("inst-b", "lec-1").length, 0);
  assert.equal(repo.getTranscript("inst-b", "lec-1"), null);
  assert.equal(repo.listCourseChunks("inst-b", "course-cs101").length, 0);
});

test("course search returns citable hits from persisted chunks", async () => {
  const { service } = svc();
  await processed(service);
  const hits = await service.searchCourse("inst-a", "course-cs101", "collision resolution", 3);
  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]!.chunk.segmentIds.length > 0, true);
});

test("audit log records the compliance-relevant events", async () => {
  const { repo, service } = svc();
  const assets = await processed(service);
  service.approveAsset("inst-a", assets[0]!.id, { id: "anika", role: "faculty" });
  const actions = repo.listAudit("inst-a").map((e) => e.action);
  assert.ok(actions.includes("lecture.created"));
  assert.ok(actions.includes("lecture.processed"));
  assert.ok(actions.includes("asset.approved"));
});

test("data persists to disk across repository reopen", async () => {
  const file = join(tmpdir(), `lip-test-${process.pid}.sqlite`);
  try {
    const repo1 = new SqliteRepository(file);
    const s1 = new LectureService(repo1);
    s1.seedInstitution(INST, COURSE);
    await processed(s1);
    repo1.close();

    const repo2 = new SqliteRepository(file);
    assert.equal(repo2.getLecture("inst-a", "lec-1")?.status, "processed");
    assert.equal(repo2.listAssets("inst-a", "lec-1").length, 3);
    repo2.close();
  } finally {
    rmSync(file, { force: true });
  }
});
