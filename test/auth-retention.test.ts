import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  AuthorizationError,
} from "../src/services/lecture-service.ts";
import {
  SessionStore,
  parseCookies,
  hasRole,
  type Identity,
} from "../src/auth/session.ts";
import type { Institution, Course, Lecture } from "../src/persistence/repository.ts";

const INST: Institution = {
  id: "inst-a",
  name: "State University",
  consentPolicy: "all_party",
  dataRegion: "us-east",
  retentionDays: 365,
};
const COURSE: Course = { id: "cs101", institutionId: "inst-a", code: "CS101", title: "DS" };

function svc() {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  service.seedInstitution(INST, COURSE);
  return { repo, service };
}

async function makeProcessed(service: LectureService, id = "lec-1") {
  service.createLecture({
    institutionId: "inst-a",
    courseId: "cs101",
    lectureId: id,
    mediaRef: "media://x",
    captureSource: "upload",
    consent: { noticeShown: true },
  });
  await service.processLecture("inst-a", id);
}

// ── session/cookie/RBAC primitives ──
test("session store issues and resolves opaque tokens", () => {
  const store = new SessionStore();
  const id: Identity = { id: "anika", name: "Anika", role: "faculty", institutionId: "inst-a" };
  const s = store.create(id);
  assert.equal(s.token.length > 20, true);
  assert.equal(store.get(s.token)?.identity.role, "faculty");
  store.destroy(s.token);
  assert.equal(store.get(s.token), null);
});

test("parseCookies handles the session cookie", () => {
  const c = parseCookies("theme=dark; lip_sid=abc123; x=y");
  assert.equal(c.lip_sid, "abc123");
});

test("hasRole enforces role membership and rejects null identity", () => {
  const admin: Identity = { id: "t", name: "T", role: "admin", institutionId: "inst-a" };
  assert.equal(hasRole(admin, ["admin"]), true);
  assert.equal(hasRole(admin, ["faculty"]), false);
  assert.equal(hasRole(null, ["admin"]), false);
});

// ── deletion (right to erasure) ──
test("faculty can delete a lecture and all derived data is gone", async () => {
  const { repo, service } = svc();
  await makeProcessed(service);
  service.deleteLecture("inst-a", "lec-1", { id: "anika", role: "faculty" });
  assert.equal(repo.getLecture("inst-a", "lec-1"), null);
  assert.equal(repo.getTranscript("inst-a", "lec-1"), null);
  assert.equal(repo.listAssets("inst-a", "lec-1").length, 0);
  assert.equal(repo.listCourseChunks("inst-a", "cs101").length, 0);
});

test("students cannot delete lectures", async () => {
  const { service } = svc();
  await makeProcessed(service);
  assert.throws(
    () => service.deleteLecture("inst-a", "lec-1", { id: "sam", role: "student" }),
    AuthorizationError,
  );
});

// ── retention ──
test("retention purges lectures older than retentionDays, keeps recent ones", async () => {
  const { repo, service } = svc();
  // Insert an old lecture directly with a backdated createdAt (400 days ago).
  const old: Lecture = {
    id: "lec-old",
    institutionId: "inst-a",
    courseId: "cs101",
    mediaRef: "media://old",
    status: "processed",
    captureSource: "upload",
    createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
  };
  repo.createLecture(old);
  repo.saveConsent({ lectureId: "lec-old", institutionId: "inst-a", policy: "all_party", noticeShown: true, optOuts: [] });
  await makeProcessed(service, "lec-recent");

  const purged = service.runRetention("inst-a", { id: "root", role: "admin" });
  assert.equal(purged, 1);
  assert.equal(repo.getLecture("inst-a", "lec-old"), null);
  assert.ok(repo.getLecture("inst-a", "lec-recent"));
});

test("only admin can run retention", () => {
  const { service } = svc();
  assert.throws(
    () => service.runRetention("inst-a", { id: "anika", role: "faculty" }),
    AuthorizationError,
  );
});
