import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  AuthorizationError,
  type Actor,
} from "../src/services/lecture-service.ts";
import { MockCaptureSource, getCaptureSource } from "../src/integrations/capture.ts";
import { MockLmsConnector } from "../src/integrations/lms.ts";
import type { Institution, Course } from "../src/persistence/repository.ts";

const INST: Institution = {
  id: "inst-a",
  name: "State University",
  consentPolicy: "all_party",
  dataRegion: "us-east",
  retentionDays: 365,
};
const COURSE: Course = { id: "cs101", institutionId: "inst-a", code: "CS101", title: "DS" };
const FACULTY: Actor = { id: "anika", role: "faculty" };

async function svc() {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  await service.seedInstitution(INST, COURSE);
  return { repo, service };
}

test("import from capture source creates lectures and is idempotent", async () => {
  const { repo, service } = await svc();
  const first = await service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "CS101-2026S", FACULTY);
  assert.equal(first.length, 2);
  assert.equal((await repo.listLecturesByCourse("inst-a", "cs101")).length, 2);
  // Re-import: nothing new (idempotent).
  const second = await service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "CS101-2026S", FACULTY);
  assert.equal(second.length, 0);
  assert.equal((await repo.listLecturesByCourse("inst-a", "cs101")).length, 2);
});

test("imported lecture carries captured consent and can be processed", async () => {
  const { service } = await svc();
  const [id] = await service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "CS101-2026S", FACULTY);
  // consentCaptured=true in the mock → compliance gate passes.
  const assets = await service.processLecture("inst-a", id!);
  assert.equal(assets.length, 3);
});

test("students cannot import recordings", async () => {
  const { service } = await svc();
  await assert.rejects(
    () => service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "X", { id: "sam", role: "student" }),
    AuthorizationError,
  );
});

test("publishToLms sends only approved assets", async () => {
  const { service } = await svc();
  const [id] = await service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "CS101-2026S", FACULTY);
  const assets = await service.processLecture("inst-a", id!);
  const lms = new MockLmsConnector();

  // Nothing approved yet → nothing published.
  assert.equal(await service.publishToLms("inst-a", id!, lms, "CS101-2026S", FACULTY), 0);
  assert.equal(lms.published.length, 0);

  // Approve one → exactly one published, with a rendered body.
  await service.approveAsset("inst-a", assets[0]!.id, FACULTY);
  const count = await service.publishToLms("inst-a", id!, lms, "CS101-2026S", FACULTY);
  assert.equal(count, 1);
  assert.equal(lms.published.length, 1);
  assert.equal(lms.published[0]!.externalCourseId, "CS101-2026S");
  assert.equal(lms.published[0]!.item.body.length > 0, true);
});

test("students cannot publish to LMS", async () => {
  const { service } = await svc();
  const [id] = await service.importFromCapture("inst-a", "cs101", new MockCaptureSource(), "X", FACULTY);
  await assert.rejects(
    () => service.publishToLms("inst-a", id!, new MockLmsConnector(), "X", { id: "sam", role: "student" }),
    AuthorizationError,
  );
});

test("unimplemented capture sources fail clearly, not silently", async () => {
  await assert.rejects(() => getCaptureSource("echo360").listRecordings("X"), /credentials/);
});
