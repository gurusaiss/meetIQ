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
import { AccountService } from "../src/auth/accounts.ts";
import { MockEmailProvider } from "../src/integrations/email.ts";
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
    assert.equal(assets.length, 4);

    await assert.rejects(
      () => service.approveAsset("inst-pg", assets[0]!.id, { id: "sam", role: "student" }),
      AuthorizationError,
    );
    const approved = await service.approveAsset("inst-pg", assets[0]!.id, { id: "anika", role: "faculty" });
    assert.equal(approved.status, "approved");
    assert.equal((await service.studentAssets("inst-pg", "lec-2", { id: "sam", role: "student" })).length, 1);

    const hits = await service.searchCourse("inst-pg", "course-pg", { id: "sam", role: "student" }, "collision resolution", 3);
    assert.ok(hits.length > 0);
  } finally {
    await repo.close();
  }
});

maybeTest("PostgresRepository stores users and organisation profiles (accounts)", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const tag = Date.now().toString(36);
    const email = `pg-${tag}@x.test`;
    const now = new Date().toISOString();
    await repo.createUser({
      id: `u-${tag}`, email, name: "Pg User", passwordHash: "scrypt$x", institutionId: `org-${tag}`,
      sector: "uni", profile: "admin", baseRole: "admin", createdAt: now,
    });
    assert.equal((await repo.getUserByEmail(email))?.name, "Pg User");
    assert.equal(await repo.getUserByEmail("missing@x.test"), null);
    await assert.rejects(() =>
      repo.createUser({
        id: `u2-${tag}`, email, name: "Dup", passwordHash: "x", institutionId: `org-${tag}`,
        sector: "uni", profile: "admin", baseRole: "admin", createdAt: now,
      }),
    );
    await repo.createOrgProfile({
      institutionId: `org-${tag}`, sector: "uni", courseId: `c-org-${tag}`, joinCode: `CODE${tag}`.toUpperCase(),
      ownerUserId: `u-${tag}`, createdAt: now,
    });
    assert.equal((await repo.getOrgProfile(`org-${tag}`))?.courseId, `c-org-${tag}`);
    assert.equal((await repo.getOrgByJoinCode(`CODE${tag}`.toUpperCase()))?.institutionId, `org-${tag}`);
    assert.equal((await repo.listUsers(`org-${tag}`)).length, 1);
  } finally {
    await repo.close();
  }
});

// ── audit chain + legal hold (Postgres) ─────────────────────────────

import pg from "pg";
import { verifyChain } from "../src/audit/chain.ts";
import { ConflictError } from "../src/services/lecture-service.ts";

const tenant = () => `pg-legal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const evt = (inst: string, i: number) => ({
  institutionId: inst, actor: `a${i}`, action: "x.did", target: `t${i}`, ts: new Date(1_700_000_000_000 + i * 1000).toISOString(),
});

maybeTest("PostgresRepository: audit events are chained per tenant, and a direct UPDATE is detected", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  const raw = new pg.Pool({ connectionString: DATABASE_URL! });
  try {
    const t = tenant();
    for (let i = 1; i <= 4; i++) await repo.audit(evt(t, i));
    const events = await repo.listAudit(t);
    assert.equal(events.length, 4);
    assert.equal(verifyChain(events).ok, true);

    await raw.query(`UPDATE audit SET actor='nobody' WHERE institution_id=$1 AND target='t3'`, [t]);
    const v = verifyChain(await repo.listAudit(t));
    assert.equal(v.ok, false);
    assert.equal(v.brokenAt, 3);
  } finally {
    await raw.end();
    await repo.close();
  }
});

maybeTest("PostgresRepository: concurrent appends for one tenant never fork the chain (advisory lock)", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const t = tenant();
    // 25 appends racing each other: without serialisation several would read the same
    // predecessor and the chain would fork, which verify would report as broken.
    await Promise.all(Array.from({ length: 25 }, (_, i) => repo.audit(evt(t, i))));
    const events = await repo.listAudit(t);
    assert.equal(events.length, 25);
    const v = verifyChain(events);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.chained, 25);
    assert.equal(new Set(events.map((e) => e.prevHash)).size, 25, "every event has its own distinct predecessor");
  } finally {
    await repo.close();
  }
});

maybeTest("PostgresRepository: a database from before this release upgrades in place (legacy rows, then a fresh chain)", async () => {
  // Make sure the tables exist, then strip them back to the old shape.
  await new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM }).close();
  const raw = new pg.Pool({ connectionString: DATABASE_URL! });
  const t = tenant();
  try {
    await raw.query(`ALTER TABLE audit DROP COLUMN IF EXISTS hash, DROP COLUMN IF EXISTS prev_hash, DROP COLUMN IF EXISTS seq`);
    await raw.query(`ALTER TABLE lectures DROP COLUMN IF EXISTS hold_reason, DROP COLUMN IF EXISTS hold_by, DROP COLUMN IF EXISTS hold_at`);
    await raw.query(`INSERT INTO audit (institution_id,actor,action,target,ts) VALUES ($1,'old','lecture.created','l1','2025-01-01T00:00:00.000Z')`, [t]);
    await raw.query(`INSERT INTO audit (institution_id,actor,action,target,ts) VALUES ($1,'old','lecture.processed','l1','2025-01-01T00:01:00.000Z')`, [t]);
    await raw.query(`INSERT INTO lectures (id,institution_id,course_id,media_ref,status,capture_source,created_at) VALUES ($1,$2,'c1','media://x','processed','upload','2025-01-01T00:00:00.000Z')`, [`l-${t}`, t]);

    const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
    try {
      assert.equal((await repo.getLecture(t, `l-${t}`))?.hold, undefined);
      await repo.audit(evt(t, 1));
      const events = await repo.listAudit(t);
      assert.equal(events.length, 3);
      const v = verifyChain(events);
      assert.deepEqual([v.ok, v.legacy, v.chained], [true, 2, 1]);

      await repo.setLegalHold(t, `l-${t}`, { reason: "Matter 42", by: "pat", at: "2026-01-01T00:00:00.000Z" });
      assert.equal((await repo.getLecture(t, `l-${t}`))?.hold?.reason, "Matter 42");
      await repo.setLegalHold(t, `l-${t}`, null);
      assert.equal((await repo.getLecture(t, `l-${t}`))?.hold, undefined);
    } finally {
      await repo.close();
    }
  } finally {
    await raw.end();
  }
});

maybeTest("LectureService against PostgresRepository: legal hold blocks delete and retention; transcript fingerprint verifies", async () => {
  const t = tenant();
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const service = new LectureService(repo);
    await service.seedInstitution({ ...INST, id: t, retentionDays: 30 }, { ...COURSE, id: `c-${t}`, institutionId: t });
    await service.createLecture({
      institutionId: t, courseId: `c-${t}`, lectureId: `lec-${t}`, mediaRef: "media://x",
      captureSource: "upload", consent: { noticeShown: true },
    });
    await service.processLecture(t, `lec-${t}`, { diarize: true });
    const staff = { id: "alex", role: "faculty" as const };
    const admin = { id: "pat", role: "admin" as const };

    assert.equal((await service.verifyTranscriptIntegrity(t, `lec-${t}`, staff)).status, "match");

    await service.placeLegalHold(t, `lec-${t}`, "Smith v. Jones", staff);
    await assert.rejects(() => service.placeLegalHold(t, `lec-${t}`, "again", staff), ConflictError);
    await assert.rejects(() => service.deleteLecture(t, `lec-${t}`, admin), ComplianceError);
    const later = new Date(Date.now() + 45 * 86_400_000);
    assert.deepEqual(await service.runRetentionDetailed(t, admin, later), { purged: 0, heldSkipped: 1 });
    assert.ok(await repo.getLecture(t, `lec-${t}`));

    await service.releaseLegalHold(t, `lec-${t}`, admin);
    assert.deepEqual(await service.runRetentionDetailed(t, admin, later), { purged: 1, heldSkipped: 0 });

    const trail = await service.auditTrail(t, admin);
    assert.equal(trail.verification.ok, true, trail.verification.reason);
  } finally {
    await repo.close();
  }
});

// ── action tracker (Postgres) ───────────────────────────────────────

maybeTest("PostgresRepository: action statuses upsert, stay tenant-scoped, and go when their lecture is deleted", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const a = tenant();
    const b = tenant();
    const st = (inst: string, lec: string, i: number, done: boolean, assignee: string | null) => ({
      institutionId: inst, lectureId: lec, itemIndex: i, done, assignee, updatedBy: "mia", updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.upsertActionStatus(st(a, "m1", 0, false, "Priya"));
    await repo.upsertActionStatus(st(a, "m1", 0, true, "Priya"));   // update, not a duplicate row
    await repo.upsertActionStatus(st(a, "m1", 1, false, null));
    await repo.upsertActionStatus(st(a, "m2", 0, true, null));
    await repo.upsertActionStatus(st(b, "m1", 0, true, "Other org"));

    const rows = await repo.listActionStatuses(a);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => [r.lectureId, r.itemIndex, r.done, r.assignee]), [
      ["m1", 0, true, "Priya"], ["m1", 1, false, null], ["m2", 0, true, null],
    ]);
    assert.equal((await repo.listActionStatuses(b)).length, 1, "another tenant's rows are separate, even with the same lecture id");

    await repo.deleteLecture(a, "m1");
    assert.deepEqual((await repo.listActionStatuses(a)).map((r) => r.lectureId), ["m2"]);
    assert.equal((await repo.listActionStatuses(b)).length, 1, "and the other tenant's m1 statuses are untouched");
  } finally {
    await repo.close();
  }
});

maybeTest("LectureService against PostgresRepository: the action tracker end to end", async () => {
  const t = tenant();
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const service = new LectureService(repo);
    await service.seedInstitution({ ...INST, id: t }, { ...COURSE, id: `c-${t}`, institutionId: t });
    await service.createLecture({
      institutionId: t, courseId: `c-${t}`, lectureId: `mtg-${t}`, mediaRef: "media://x",
      captureSource: "upload", consent: { noticeShown: true },
    });
    const assets = await service.processLecture(t, `mtg-${t}`, { diarize: true });
    const manager = { id: "mia", role: "faculty" as const };

    assert.deepEqual(await service.listActionItems(t, `c-${t}`, manager), [], "nothing before approval");
    await service.approveAsset(t, assets.find((a) => a.type === "actions")!.id, manager);
    const items = await service.listActionItems(t, `c-${t}`, manager);
    assert.equal(items.length > 0, true);

    await service.updateActionItem(t, `mtg-${t}`, 0, { assignee: "Priya Nair", done: true }, manager);
    const [first] = await service.listActionItems(t, `c-${t}`, manager);
    assert.deepEqual([first!.done, first!.assignee, first!.updatedBy], [true, "Priya Nair", "mia"]);

    const trail = await service.auditTrail(t, { id: "root", role: "admin" });
    assert.equal(trail.verification.ok, true, trail.verification.reason);
    assert.ok(trail.events.some((e) => e.action === "action_item.completed"));
  } finally {
    await repo.close();
  }
});

// ── multi-course (Postgres) ─────────────────────────────────────────

maybeTest("PostgresRepository: courses round-trip in creation order, patch without being reset by a re-upsert, and enrol idempotently", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const t = tenant();
    const mk = (id: string, code: string, joinCode: string | null) => ({
      id: `${t}-${id}`, institutionId: t, code, title: `Title ${code}`, joinCode, externalId: null, archived: false, createdBy: "mia", createdAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.upsertCourse(mk("a", "A1", `JA${t}`.slice(0, 20).toUpperCase()));
    await repo.upsertCourse(mk("b", "B2", `JB${t}`.slice(0, 20).toUpperCase()));
    await repo.upsertCourse(mk("c", "C3", null));
    assert.deepEqual((await repo.listCourses(t)).map((c) => c.code), ["A1", "B2", "C3"], "creation order");
    assert.equal((await repo.getCourseByJoinCode(`JB${t}`.slice(0, 20).toUpperCase()))?.code, "B2");
    assert.equal(await repo.getCourseByJoinCode("NOPE"), null);
    assert.equal(await repo.getCourse("someone-else", `${t}-a`), null, "scoped to the organisation");

    await repo.updateCourse(t, `${t}-b`, { archived: true, title: "Renamed", externalId: "48213" });
    await repo.upsertCourse({ ...mk("b", "B2", null), title: "Seeded title" }); // what the startup seed does
    const b = (await repo.getCourse(t, `${t}-b`))!;
    assert.deepEqual([b.title, b.archived, b.externalId, b.joinCode], ["Seeded title", true, "48213", `JB${t}`.slice(0, 20).toUpperCase()], "a re-seed only refreshes code and title");

    await assert.rejects(() => repo.upsertCourse(mk("d", "D4", `JA${t}`.slice(0, 20).toUpperCase())), "a join code is unique system-wide");

    const m = (userId: string) => ({ institutionId: t, courseId: `${t}-a`, userId, enrolledAt: "2026-01-02T00:00:00.000Z" });
    await repo.addCourseMember(m("u1"));
    await repo.addCourseMember(m("u1"));
    await repo.addCourseMember(m("u2"));
    assert.deepEqual((await repo.listCourseMembers(t, `${t}-a`)).map((x) => x.userId), ["u1", "u2"]);
    assert.deepEqual(await repo.listMemberCourseIds(t, "u1"), [`${t}-a`]);
    assert.deepEqual(await repo.listMemberCourseIds("someone-else", "u1"), [], "scoped to the organisation");
    await repo.removeCourseMember(t, `${t}-a`, "u1");
    assert.deepEqual((await repo.listCourseMembers(t, `${t}-a`)).map((x) => x.userId), ["u2"]);
  } finally {
    await repo.close();
  }
});

maybeTest("PostgresRepository: a database whose courses table predates multi-course upgrades in place, keeping its order", async () => {
  await new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM }).close();
  const raw = new pg.Pool({ connectionString: DATABASE_URL! });
  const t = tenant();
  try {
    await raw.query(`DROP INDEX IF EXISTS idx_courses_join_code`);
    await raw.query(`ALTER TABLE courses DROP COLUMN IF EXISTS join_code, DROP COLUMN IF EXISTS external_id, DROP COLUMN IF EXISTS archived, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS seq`);
    await raw.query(`INSERT INTO courses (id,institution_id,code,title) VALUES ($1,$2,'MAIN','Old Workspace')`, [`${t}-old`, t]);

    const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
    try {
      const old = (await repo.getCourse(t, `${t}-old`))!;
      assert.deepEqual([old.joinCode, old.externalId, old.archived, old.createdBy], [null, null, false, null]);
      await repo.upsertCourse({ id: `${t}-new`, institutionId: t, code: "CS2", title: "Second", joinCode: `NEW${t}`.slice(0, 20).toUpperCase(), createdAt: "2026-02-01T00:00:00.000Z" });
      assert.deepEqual((await repo.listCourses(t)).map((c) => c.code), ["MAIN", "CS2"], "the old course stays first");
      await repo.updateCourse(t, `${t}-old`, { joinCode: `OLD${t}`.slice(0, 20).toUpperCase() });
      assert.equal((await repo.getCourseByJoinCode(`OLD${t}`.slice(0, 20).toUpperCase()))?.id, `${t}-old`);
    } finally {
      await repo.close();
    }
  } finally {
    await raw.end();
  }
});

maybeTest("LectureService against PostgresRepository: course enrolment gates released material end to end", async () => {
  const t = tenant();
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const service = new LectureService(repo);
    await service.seedInstitution({ ...INST, id: t }, { id: `main-${t}`, institutionId: t, code: "MAIN", title: "Main" });
    const prof = { id: "prof", role: "faculty" as const };
    const dean = { id: "dean", role: "admin" as const };
    const ann = { id: "ann", role: "student" as const };
    const cs = await service.createCourse(t, { code: "CS101", title: "DS" }, prof);

    await service.createLecture({ institutionId: t, courseId: cs.id, lectureId: `lec-${t}`, mediaRef: "media://x", captureSource: "upload", consent: { noticeShown: true } });
    const assets = await service.processLecture(t, `lec-${t}`, { diarize: true });
    for (const a of assets) await service.approveAsset(t, a.id, prof);

    await assert.rejects(() => service.studentAssets(t, `lec-${t}`, ann), (e: Error) => e.name === "NotFoundError");
    assert.equal(await service.canAccessCourse(t, `main-${t}`, ann), true, "the first course is open to everyone");

    await service.joinCourse(t, cs.joinCode!, ann);
    assert.ok((await service.studentAssets(t, `lec-${t}`, ann)).length > 0);
    assert.ok((await service.searchCourse(t, cs.id, ann, "collision resolution")).length > 0);

    await service.setCourseArchived(t, cs.id, true, dean);
    await assert.rejects(() => service.studentAssets(t, `lec-${t}`, ann), (e: Error) => e.name === "NotFoundError");
    await service.setCourseArchived(t, cs.id, false, dean);
    await service.removeCourseMember(t, cs.id, "ann", prof);
    await assert.rejects(() => service.studentAssets(t, `lec-${t}`, ann), (e: Error) => e.name === "NotFoundError");

    const trail = await service.auditTrail(t, dean);
    assert.equal(trail.verification.ok, true, trail.verification.reason);
  } finally {
    await repo.close();
  }
});

// ── email verification / password reset (Postgres) ─────────────────

maybeTest("PostgresRepository: email-verified flag and auth tokens round-trip, with validity rules enforced by the DB layer", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const email = `pg-auth-${tag}@x.test`;
    const now = new Date().toISOString();
    await repo.createUser({
      id: `u-${tag}`, email, name: "Pg User", passwordHash: "scrypt$x", institutionId: `org-${tag}`,
      sector: "uni", profile: "admin", baseRole: "admin", createdAt: now,
    });
    const fresh = await repo.getUserById(`u-${tag}`);
    assert.equal(fresh?.emailVerified, false, "unset reads back false, not undefined/null");
    assert.equal(await repo.getUserById("no-such-user"), null);

    await repo.setEmailVerified(`u-${tag}`, true);
    assert.equal((await repo.getUserById(`u-${tag}`))?.emailVerified, true);

    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    await repo.createAuthToken({ tokenHash: `good-${tag}`, userId: `u-${tag}`, kind: "verify_email", expiresAt: future });
    await repo.createAuthToken({ tokenHash: `old-${tag}`, userId: `u-${tag}`, kind: "verify_email", expiresAt: past });
    await repo.createAuthToken({ tokenHash: `reset-${tag}`, userId: `u-${tag}`, kind: "reset_password", expiresAt: future });

    assert.equal((await repo.getValidAuthToken(`good-${tag}`, "verify_email"))?.userId, `u-${tag}`);
    assert.equal(await repo.getValidAuthToken(`old-${tag}`, "verify_email"), null, "expired");
    assert.equal(await repo.getValidAuthToken(`good-${tag}`, "reset_password"), null, "right hash, wrong kind");
    assert.equal(await repo.getValidAuthToken(`missing-${tag}`, "verify_email"), null);

    await repo.markAuthTokenUsed(`good-${tag}`);
    assert.equal(await repo.getValidAuthToken(`good-${tag}`, "verify_email"), null, "used");
    assert.equal((await repo.getValidAuthToken(`reset-${tag}`, "reset_password"))?.kind, "reset_password", "a different token is unaffected");
  } finally {
    await repo.close();
  }
});

maybeTest("AccountService against PostgresRepository: verify + reset end to end", async () => {
  const repo = new PostgresRepository({ connectionString: DATABASE_URL!, vectorDim: VECTOR_DIM });
  try {
    const email = new MockEmailProvider();
    const accounts = new AccountService(repo, email, "https://app.test");
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const identity = await accounts.signUp({
      mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: `pg-flow-${tag}@x.test`, password: "Sturdy-pass-9", orgName: "State U",
    });
    const verifyLink = email.sent.find((m) => /Verify/.test(m.subject))!.text.match(/token=([0-9a-f]+)/)![1]!;
    await accounts.verifyEmail(verifyLink);
    assert.equal((await repo.getUserById(identity.id))?.emailVerified, true);

    await accounts.requestPasswordReset(`pg-flow-${tag}@x.test`);
    const resetLink = email.sent.find((m) => /Reset/.test(m.subject))!.text.match(/token=([0-9a-f]+)/)![1]!;
    await accounts.resetPassword(resetLink, "Brand-new-pass-1");
    await assert.rejects(() => accounts.signIn(`pg-flow-${tag}@x.test`, "Sturdy-pass-9"));
    assert.ok(await accounts.signIn(`pg-flow-${tag}@x.test`, "Brand-new-pass-1"));
  } finally {
    await repo.close();
  }
});
