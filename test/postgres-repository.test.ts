/**
 * Integration test for PostgresRepository against a REAL Postgres+pgvector
 * instance (not mocked) — this is the point of the adapter: proving the
 * schema, the pgvector extension, and every Repository method actually work
 * against the real database, not just typecheck against the interface.
 *
 * Requires DATABASE_URL to point at a reachable Postgres with the pgvector
 * extension installable (CREATE EXTENSION IF NOT EXISTS vector — needs
 * superuser or a role with the right grant, which the default postgres user
 * has). Skips cleanly if DATABASE_URL isn't set, so `npm test` still passes
 * in this repo's default zero-infra mode.
 *
 *   docker run -d --name lip-pg-test -e POSTGRES_PASSWORD=devpass \
 *     -e POSTGRES_DB=lip -p 55432:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgres://postgres:devpass@localhost:55432/lip npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresRepository } from "../src/persistence/postgres.ts";
import { LectureService, AuthorizationError, ComplianceError } from "../src/services/lecture-service.ts";
import type { Institution, Course } from "../src/persistence/repository.ts";
import type { Chunk } from "../src/types.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const maybeTest = DATABASE_URL ? test : test.skip;

const INST: Institution = {
  id: "inst-pg",
  name: "State University",
  consentPolicy: "all_party",
  dataRegion: "us-east",
  retentionDays: 365,
};
const COURSE: Course = { id: "course-pg", institutionId: "inst-pg", code: "CS101", title: "DS" };

// pgvector's column dimension is fixed at CREATE TABLE time — every
// PostgresRepository instance pointed at this database MUST agree on the
// same vectorDim (256, matching the real MockEmbeddingsProvider used by the
// pipeline), or later inserts from a different-dim instance fail outright.
const VECTOR_DIM = 256;

async function freshRepo(): Promise<PostgresRepository> {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  // Isolate each test: wipe tenant-scoped rows from a prior run so tests
  // don't interfere with each other (same DB instance across all tests).
  await repo.deleteLecture("inst-pg", "lec-1");
  await repo.deleteLecture("inst-pg", "lec-2");
  return repo;
}

maybeTest("PostgresRepository: healthcheck against a real instance", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL! });
  assert.equal(await repo.healthcheck(), true);
  await repo.close();
});

maybeTest("PostgresRepository: full CRUD round-trip incl. pgvector embeddings", async () => {
  const repo = await freshRepo();
  try {
    await repo.upsertInstitution(INST);
    await repo.upsertCourse(COURSE);

    const got = await repo.getInstitution("inst-pg");
    assert.equal(got?.name, "State University");

    await repo.createLecture({
      id: "lec-1",
      institutionId: "inst-pg",
      courseId: "course-pg",
      mediaRef: "media://x",
      status: "created",
      captureSource: "upload",
      createdAt: new Date().toISOString(),
    });
    const lecture = await repo.getLecture("inst-pg", "lec-1");
    assert.equal(lecture?.status, "created");

    await repo.setLectureStatus("inst-pg", "lec-1", "processed");
    assert.equal((await repo.getLecture("inst-pg", "lec-1"))?.status, "processed");

    await repo.saveConsent({
      lectureId: "lec-1",
      institutionId: "inst-pg",
      policy: "all_party",
      noticeShown: true,
      optOuts: ["x@example.com"],
    });
    const consent = await repo.getConsent("inst-pg", "lec-1");
    assert.equal(consent?.noticeShown, true);
    assert.deepEqual(consent?.optOuts, ["x@example.com"]);

    await repo.saveTranscript("inst-pg", {
      lectureId: "lec-1",
      language: "en",
      provider: "mock",
      segments: [{ id: "seg-0", start: 0, end: 1, speaker: null, text: "hi", confidence: 0.9 }],
    });
    const transcript = await repo.getTranscript("inst-pg", "lec-1");
    assert.equal(transcript?.segments.length, 1);

    const stored = await repo.saveAssets("inst-pg", "lec-1", [
      { type: "notes", status: "draft", content: { topics: [] }, flagRatio: 0, ungroundedRatio: 0 },
    ]);
    assert.equal(stored.length, 1);
    await repo.setAssetStatus("inst-pg", stored[0]!.id, "approved");
    const assets = await repo.listAssets("inst-pg", "lec-1");
    assert.equal(assets[0]!.status, "approved");

    // This is the part that actually proves pgvector, not just JSON storage:
    // a real `vector(256)` column round-tripping real floats.
    const chunk: Chunk = {
      id: "chunk-1",
      lectureId: "lec-1",
      text: "hash tables",
      segmentIds: ["seg-0"],
      start: 0,
      embedding: Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(i) * 0.5),
    };
    await repo.saveChunks("inst-pg", "course-pg", [chunk]);
    const chunks = await repo.listCourseChunks("inst-pg", "course-pg");
    assert.equal(chunks.length, 1);
    // Floats round-trip through Postgres text formatting with limited
    // precision — compare approximately, not with strict equality.
    chunks[0]!.embedding.forEach((v, i) => {
      assert.ok(Math.abs(v - chunk.embedding[i]!) < 1e-4, `embedding[${i}] should round-trip`);
    });

    await repo.audit({ institutionId: "inst-pg", actor: "anika", action: "test.event", target: "lec-1", ts: new Date().toISOString() });
    const audit = await repo.listAudit("inst-pg");
    assert.ok(audit.some((e) => e.action === "test.event"));
  } finally {
    await repo.close();
  }
});

maybeTest("PostgresRepository: tenant isolation is enforced in SQL", async () => {
  const repo = await freshRepo();
  try {
    await repo.upsertInstitution(INST);
    await repo.upsertCourse(COURSE);
    await repo.createLecture({
      id: "lec-1",
      institutionId: "inst-pg",
      courseId: "course-pg",
      mediaRef: "media://x",
      status: "created",
      captureSource: "upload",
      createdAt: new Date().toISOString(),
    });
    assert.equal(await repo.getLecture("inst-other", "lec-1"), null);
    assert.equal((await repo.listAssets("inst-other", "lec-1")).length, 0);
  } finally {
    await repo.close();
  }
});

maybeTest("PostgresRepository: right-to-erasure removes all derived data", async () => {
  const repo = await freshRepo();
  try {
    await repo.upsertInstitution(INST);
    await repo.upsertCourse(COURSE);
    await repo.createLecture({
      id: "lec-2",
      institutionId: "inst-pg",
      courseId: "course-pg",
      mediaRef: "media://x",
      status: "processed",
      captureSource: "upload",
      createdAt: new Date().toISOString(),
    });
    await repo.saveConsent({ lectureId: "lec-2", institutionId: "inst-pg", policy: "all_party", noticeShown: true, optOuts: [] });
    await repo.saveTranscript("inst-pg", { lectureId: "lec-2", language: "en", provider: "mock", segments: [] });
    await repo.saveAssets("inst-pg", "lec-2", [
      { type: "quiz", status: "draft", content: { questions: [] }, flagRatio: 0, ungroundedRatio: 0 },
    ]);
    await repo.saveChunks("inst-pg", "course-pg", [
      { id: "chunk-2", lectureId: "lec-2", text: "x", segmentIds: [], start: 0, embedding: new Array(VECTOR_DIM).fill(0) },
    ]);

    await repo.deleteLecture("inst-pg", "lec-2");

    assert.equal(await repo.getLecture("inst-pg", "lec-2"), null);
    assert.equal(await repo.getConsent("inst-pg", "lec-2"), null);
    assert.equal(await repo.getTranscript("inst-pg", "lec-2"), null);
    assert.equal((await repo.listAssets("inst-pg", "lec-2")).length, 0);
  } finally {
    await repo.close();
  }
});

// ── End-to-end through LectureService, exactly like the SQLite service tests ──
maybeTest("LectureService against PostgresRepository: full lifecycle parity", async () => {
  const repo = await freshRepo();
  const service = new LectureService(repo);
  try {
    await service.seedInstitution(INST, COURSE);

    await service.createLecture({
      institutionId: "inst-pg",
      courseId: "course-pg",
      lectureId: "lec-1",
      mediaRef: "media://x",
      captureSource: "upload",
      consent: { noticeShown: false },
    });
    await assert.rejects(() => service.processLecture("inst-pg", "lec-1"), ComplianceError);

    await service.createLecture({
      institutionId: "inst-pg",
      courseId: "course-pg",
      lectureId: "lec-2",
      mediaRef: "media://hash-tables.mp4",
      captureSource: "upload",
      consent: { noticeShown: true },
    });
    const assets = await service.processLecture("inst-pg", "lec-2", { diarize: true });
    assert.equal(assets.length, 3);

    await assert.rejects(
      () => service.approveAsset("inst-pg", assets[0]!.id, { id: "sam", role: "student" }),
      AuthorizationError,
    );
    const approved = await service.approveAsset("inst-pg", assets[0]!.id, { id: "anika", role: "faculty" });
    assert.equal(approved.status, "approved");
    assert.equal((await service.studentAssets("inst-pg", "lec-2")).length, 1);

    const hits = await service.searchCourse("inst-pg", "course-pg", "collision resolution", 3);
    assert.ok(hits.length > 0);
  } finally {
    await repo.close();
  }
});
