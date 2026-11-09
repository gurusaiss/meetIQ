import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import { AccountService } from "../src/auth/accounts.ts";
import {
  LectureService,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../src/services/lecture-service.ts";
import type { Identity } from "../src/auth/session.ts";

const PW = "Sturdy-pass-9";

/** A real university organisation: an admin who created it, plus faculty, a TA and two students who joined. */
async function university() {
  const repo = new SqliteRepository(":memory:");
  const accounts = new AccountService(repo);
  const service = new LectureService(repo);
  const dean = await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dean Dee", email: "dean@u.test", password: PW, orgName: "State U" });
  const code = (await accounts.inviteCodeFor(dean))!;
  const join = (roleId: string, name: string, email: string) =>
    accounts.signUp({ mode: "join", sector: "uni", roleId, name, email, password: PW, joinCode: code });
  const prof = await join("faculty", "Prof Pat", "pat@u.test");
  const ta = await join("ta", "Tia TA", "tia@u.test");
  const ann = await join("student", "Ann", "ann@u.test");
  const ben = await join("student", "Ben", "ben@u.test");
  return { repo, accounts, service, dean, prof, ta, ann, ben, inst: dean.institutionId, main: dean.courseId! };
}
type U = Awaited<ReturnType<typeof university>>;

/** Process a lecture into `courseId` and have faculty release everything, as a normal course would. */
async function releasedLecture(u: U, courseId: string, lectureId: string) {
  await u.service.createLecture({
    institutionId: u.inst, courseId, lectureId, mediaRef: "media://x", captureSource: "upload", consent: { noticeShown: true },
  });
  const assets = await u.service.processLecture(u.inst, lectureId, { diarize: true });
  for (const a of assets) await u.service.approveAsset(u.inst, a.id, u.prof);
}

// ── creating and editing courses ────────────────────────────────────

test("faculty and admins can create a course; TAs and students cannot", async () => {
  const u = await university();
  const made = await u.service.createCourse(u.inst, { code: "CS101", title: "Data Structures", externalId: " 48213 " }, u.prof);
  assert.equal(made.code, "CS101");
  assert.equal(made.title, "Data Structures");
  assert.equal(made.externalId, "48213", "trimmed");
  assert.match(made.id, /^course-[0-9a-f]{12}$/);
  assert.match(made.joinCode!, /^[A-HJ-NP-Z2-9]{8}$/, "same readable alphabet as organisation codes");
  assert.equal(made.createdBy, u.prof.id);
  assert.equal(made.archived, false);

  await u.service.createCourse(u.inst, { code: "CS102", title: "Algorithms" }, u.dean);
  for (const who of [u.ta, u.ann]) {
    await assert.rejects(() => u.service.createCourse(u.inst, { code: "X1", title: "No" }, who), AuthorizationError, who.role);
  }
  const events = (await u.repo.listAudit(u.inst)).filter((e) => e.action === "course.created");
  assert.deepEqual(events.map((e) => e.target), [`${made.id}: CS101`, `${(await u.repo.listCourses(u.inst))[2]!.id}: CS102`]);
});

test("course fields are validated, and a code can't be reused in the same organisation (any case)", async () => {
  const u = await university();
  for (const code of ["", "  ", "-bad", "a".repeat(25), "CS<101>", "CS/101"]) {
    await assert.rejects(() => u.service.createCourse(u.inst, { code, title: "Ok" }, u.prof), ValidationError, JSON.stringify(code));
  }
  for (const title of ["", "   ", "t".repeat(81)]) {
    await assert.rejects(() => u.service.createCourse(u.inst, { code: "OK1", title }, u.prof), ValidationError, JSON.stringify(title));
  }
  await assert.rejects(() => u.service.createCourse(u.inst, { code: "OK1", title: "Ok", externalId: "x".repeat(121) }, u.prof), ValidationError);

  await u.service.createCourse(u.inst, { code: "CS101", title: "A" }, u.prof);
  await assert.rejects(() => u.service.createCourse(u.inst, { code: "cs101", title: "B" }, u.prof), ConflictError);
  await assert.rejects(() => u.service.createCourse(u.inst, { code: "MAIN", title: "B" }, u.prof), ConflictError, "the original course counts too");
});

test("faculty can rename a course and change its code and external id; the code stays unique", async () => {
  const u = await university();
  const a = await u.service.createCourse(u.inst, { code: "CS101", title: "Old title" }, u.prof);
  await u.service.createCourse(u.inst, { code: "CS102", title: "Other" }, u.prof);

  await u.service.updateCourse(u.inst, a.id, { title: "  Data   Structures ", externalId: "SIS-9" }, u.prof);
  const got = (await u.repo.getCourse(u.inst, a.id))!;
  assert.deepEqual([got.title, got.code, got.externalId], ["Data Structures", "CS101", "SIS-9"]);

  await u.service.updateCourse(u.inst, a.id, { code: "cs101" }, u.prof); // its own code, different case: fine
  await assert.rejects(() => u.service.updateCourse(u.inst, a.id, { code: "CS102" }, u.prof), ConflictError);
  await u.service.updateCourse(u.inst, a.id, { externalId: "" }, u.dean);
  assert.equal((await u.repo.getCourse(u.inst, a.id))!.externalId, null, "blank clears it");

  await assert.rejects(() => u.service.updateCourse(u.inst, a.id, { title: "x" }, u.ta), AuthorizationError);
  await assert.rejects(() => u.service.updateCourse(u.inst, "nope", { title: "x" }, u.prof), NotFoundError);
  assert.ok((await u.repo.listAudit(u.inst)).some((e) => e.action === "course.updated" && e.target === a.id));
});

// ── who can reach which course ──────────────────────────────────────

test("everyone reaches the main course; a new course needs enrolment for students, but not for staff", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);

  for (const who of [u.dean, u.prof, u.ta, u.ann, u.ben]) {
    assert.equal(await u.service.canAccessCourse(u.inst, u.main, who), true, `main / ${who.role}`);
  }
  for (const staff of [u.dean, u.prof, u.ta]) {
    assert.equal(await u.service.canAccessCourse(u.inst, cs.id, staff), true, `new / ${staff.role}`);
  }
  assert.equal(await u.service.canAccessCourse(u.inst, cs.id, u.ann), false);
  assert.deepEqual((await u.service.accessibleCourses(u.inst, u.ann)).map((c) => c.code), ["MAIN"]);
  assert.deepEqual((await u.service.accessibleCourses(u.inst, u.prof)).map((c) => c.code), ["MAIN", "CS101"]);

  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann);
  assert.equal(await u.service.canAccessCourse(u.inst, cs.id, u.ann), true);
  assert.equal(await u.service.canAccessCourse(u.inst, cs.id, u.ben), false, "enrolment is per person");
  assert.deepEqual((await u.service.accessibleCourses(u.inst, u.ann)).map((c) => c.code), ["MAIN", "CS101"]);
});

test("an unknown course id is never accessible", async () => {
  const u = await university();
  assert.equal(await u.service.canAccessCourse(u.inst, "nope", u.dean), false);
  assert.equal(await u.service.canAccessCourse(u.inst, "", u.dean), false);
});

test("an organisation with no profile (the shared demo) treats its first course as the one everyone reaches", async () => {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  await service.seedInstitution(
    { id: "demo", name: "Demo", consentPolicy: "all_party", dataRegion: "us-east", retentionDays: 365 },
    { id: "cs101", institutionId: "demo", code: "CS101", title: "Demo" },
  );
  assert.equal(await service.defaultCourseId("demo"), "cs101");
  const student: Actor = { id: "demo-sam", role: "student" };
  assert.equal(await service.canAccessCourse("demo", "cs101", student), true);
  const second = await service.createCourse("demo", { code: "CS102", title: "Second" }, { id: "demo-fay", role: "faculty" });
  assert.equal(await service.canAccessCourse("demo", second.id, student), false);
});

test("re-seeding an organisation at startup does not reset a course's join code, archive flag or external id", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS", externalId: "42" }, u.prof);
  await u.service.setCourseArchived(u.inst, cs.id, true, u.dean);
  // The app re-runs seedInstitution on every start, which upserts the course.
  await u.service.seedInstitution(
    { id: u.inst, name: "State U", consentPolicy: "all_party", dataRegion: "us-east", retentionDays: 365 },
    { id: cs.id, institutionId: u.inst, code: "CS101", title: "DS" },
  );
  const after = (await u.repo.getCourse(u.inst, cs.id))!;
  assert.deepEqual([after.joinCode, after.archived, after.externalId], [cs.joinCode, true, "42"]);
});

// ── enrolling ───────────────────────────────────────────────────────

test("a student enrols with the join code, however it's typed; it's idempotent and audited once", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  const c = cs.joinCode!;
  const pretty = `${c.slice(0, 4)}-${c.slice(4)}`.toLowerCase();

  assert.equal((await u.service.joinCourse(u.inst, ` ${pretty} `, u.ann)).id, cs.id);
  await u.service.joinCourse(u.inst, c, u.ann);
  await u.service.joinCourse(u.inst, pretty.toUpperCase(), u.ann);
  assert.deepEqual(await u.repo.listMemberCourseIds(u.inst, u.ann.id), [cs.id], "one membership, not three");
  const joins = (await u.repo.listAudit(u.inst)).filter((e) => e.action === "course.joined");
  assert.equal(joins.length, 1);
  assert.deepEqual([joins[0]!.actor, joins[0]!.target], [u.ann.id, cs.id]);
});

test("every bad code gets the same answer: empty, unknown, malformed, archived, or another organisation's", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  const archived = await u.service.createCourse(u.inst, { code: "OLD1", title: "Old" }, u.prof);
  await u.service.setCourseArchived(u.inst, archived.id, true, u.dean);

  // Someone from a different organisation, holding a perfectly real code from this one.
  const other = await u.accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Oz", email: "oz@o.test", password: PW, orgName: "Other U" });

  const attempts: Array<[string, Identity | Actor]> = [
    ["", u.ann], ["   ", u.ann], ["----", u.ann], ["ZZZZZZZZ", u.ann], ["not a code!", u.ann],
    [archived.joinCode!, u.ann],
    [cs.joinCode!, other],
  ];
  const messages = new Set<string>();
  for (const [code, who] of attempts) {
    const inst = who === other ? other.institutionId : u.inst;
    await assert.rejects(
      async () => {
        try { await u.service.joinCourse(inst, code, who as Actor); } catch (e) { messages.add((e as Error).message); throw e; }
      },
      ValidationError,
      JSON.stringify(code),
    );
  }
  assert.equal(messages.size, 1, "the reply doesn't reveal which codes exist");
  assert.deepEqual(await u.repo.listMemberCourseIds(u.inst, u.ann.id), []);
  assert.deepEqual(await u.repo.listMemberCourseIds(other.institutionId, other.id), []);
});

test("another organisation can't reach a course by id, as any role", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  const other = await u.accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Oz", email: "oz@o.test", password: PW, orgName: "Other U" });
  assert.equal(await u.service.canAccessCourse(other.institutionId, cs.id, other), false);
  assert.deepEqual((await u.service.accessibleCourses(other.institutionId, other)).map((c) => c.id), [other.courseId]);
});

// ── the access gate on everything that reads course material ────────

test("released lecture material is only readable by someone who can reach its course", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  await releasedLecture(u, cs.id, "cs101-week1");
  await releasedLecture(u, u.main, "main-week1");

  // Not enrolled: not found, exactly as if the lecture didn't exist.
  await assert.rejects(() => u.service.studentAssets(u.inst, "cs101-week1", u.ann), NotFoundError);
  const missing = await u.service.studentAssets(u.inst, "does-not-exist", u.ann).catch((e: Error) => e.message);
  const hidden = await u.service.studentAssets(u.inst, "cs101-week1", u.ann).catch((e: Error) => e.message);
  assert.equal(String(hidden).replace("cs101-week1", "X"), String(missing).replace("does-not-exist", "X"), "no hint that it exists");

  // Staff reach it; the main course is open to everyone as before.
  assert.ok((await u.service.studentAssets(u.inst, "cs101-week1", u.ta)).length > 0);
  assert.ok((await u.service.studentAssets(u.inst, "main-week1", u.ann)).length > 0);

  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann);
  assert.ok((await u.service.studentAssets(u.inst, "cs101-week1", u.ann)).length > 0);
  await assert.rejects(() => u.service.studentAssets(u.inst, "cs101-week1", u.ben), NotFoundError, "Ben never enrolled");
});

test("the transcript, its integrity check, search and the action tracker are gated the same way", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  await releasedLecture(u, cs.id, "cs101-week1");

  await assert.rejects(() => u.service.getTranscript(u.inst, "cs101-week1", u.ann, "view"), NotFoundError);
  await assert.rejects(() => u.service.getTranscript(u.inst, "cs101-week1", u.ann, "export"), NotFoundError);
  await assert.rejects(() => u.service.verifyTranscriptIntegrity(u.inst, "cs101-week1", u.ann), NotFoundError);
  await assert.rejects(() => u.service.searchCourse(u.inst, cs.id, u.ann, "collisions"), NotFoundError);
  await assert.rejects(() => u.service.listActionItems(u.inst, cs.id, u.ann), NotFoundError);
  assert.equal((await u.repo.listAudit(u.inst)).some((e) => e.action === "transcript.exported" || e.action === "course.search"), false, "refused reads leave no export/search trace");

  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann);
  assert.ok((await u.service.getTranscript(u.inst, "cs101-week1", u.ann, "view")).segments.length > 0);
  assert.equal((await u.service.verifyTranscriptIntegrity(u.inst, "cs101-week1", u.ann)).status, "match");
  assert.ok((await u.service.searchCourse(u.inst, cs.id, u.ann, "collision resolution")).length > 0);
  assert.ok((await u.service.listActionItems(u.inst, cs.id, u.ann)).length > 0);

  // Search never crosses courses: the main course has nothing, so nothing leaks into it from CS101.
  assert.deepEqual(await u.service.searchCourse(u.inst, u.main, u.ann, "collision resolution"), []);
});

test("search audits the real searcher, not a hard-coded 'student'", async () => {
  const u = await university();
  await releasedLecture(u, u.main, "main-week1");
  await u.service.searchCourse(u.inst, u.main, u.ann, "hash");
  const ev = (await u.repo.listAudit(u.inst)).find((e) => e.action === "course.search")!;
  assert.equal(ev.actor, u.ann.id);
});

// ── removing people, archiving, codes ───────────────────────────────

test("removing a student revokes access at once; the roster reflects it; only faculty and admins can remove", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  await releasedLecture(u, cs.id, "cs101-week1");
  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann);
  await u.service.joinCourse(u.inst, cs.joinCode!, u.ben);

  const roster = await u.service.courseRoster(u.inst, cs.id, u.ta);
  assert.deepEqual(roster.map((r) => [r.name, r.email]).sort(), [["Ann", "ann@u.test"], ["Ben", "ben@u.test"]]);

  await assert.rejects(() => u.service.removeCourseMember(u.inst, cs.id, u.ann.id, u.ta), AuthorizationError);
  await assert.rejects(() => u.service.removeCourseMember(u.inst, cs.id, u.ann.id, u.ben), AuthorizationError);
  await u.service.removeCourseMember(u.inst, cs.id, u.ann.id, u.prof);

  await assert.rejects(() => u.service.studentAssets(u.inst, "cs101-week1", u.ann), NotFoundError);
  assert.ok((await u.service.studentAssets(u.inst, "cs101-week1", u.ben)).length > 0, "others are unaffected");
  assert.deepEqual((await u.service.courseRoster(u.inst, cs.id, u.prof)).map((r) => r.name), ["Ben"]);
  assert.ok((await u.repo.listAudit(u.inst)).some((e) => e.action === "course.member_removed" && e.target === `${cs.id}: ${u.ann.id}`));

  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann); // the code is still good, so they can come back
  assert.ok((await u.service.studentAssets(u.inst, "cs101-week1", u.ann)).length > 0);
});

test("the roster is for staff only", async () => {
  const u = await university();
  await assert.rejects(() => u.service.courseRoster(u.inst, u.main, u.ann), AuthorizationError);
  await assert.rejects(() => u.service.courseRoster(u.inst, "nope", u.prof), NotFoundError);
});

test("archiving hides a course from students (even enrolled ones) and blocks joining; staff keep access; restoring undoes it", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  await releasedLecture(u, cs.id, "cs101-week1");
  await u.service.joinCourse(u.inst, cs.joinCode!, u.ann);

  await assert.rejects(() => u.service.setCourseArchived(u.inst, cs.id, true, u.prof), AuthorizationError, "faculty can't archive");
  await u.service.setCourseArchived(u.inst, cs.id, true, u.dean);

  assert.equal(await u.service.canAccessCourse(u.inst, cs.id, u.ann), false);
  await assert.rejects(() => u.service.studentAssets(u.inst, "cs101-week1", u.ann), NotFoundError);
  assert.deepEqual((await u.service.accessibleCourses(u.inst, u.ann)).map((c) => c.code), ["MAIN"]);
  await assert.rejects(() => u.service.joinCourse(u.inst, cs.joinCode!, u.ben), ValidationError);
  assert.equal(await u.service.canAccessCourse(u.inst, cs.id, u.prof), true);
  assert.ok((await u.service.accessibleCourses(u.inst, u.prof)).some((c) => c.id === cs.id && c.archived));

  await u.service.setCourseArchived(u.inst, cs.id, false, u.dean);
  assert.ok((await u.service.studentAssets(u.inst, "cs101-week1", u.ann)).length > 0, "enrolment survived the archive");
  const actions = (await u.repo.listAudit(u.inst)).map((e) => e.action);
  assert.ok(actions.includes("course.archived") && actions.includes("course.restored"));
});

test("the organisation's main course can't be archived, or everyone would be locked out", async () => {
  const u = await university();
  await assert.rejects(() => u.service.setCourseArchived(u.inst, u.main, true, u.dean), ConflictError);
  assert.equal(await u.service.canAccessCourse(u.inst, u.main, u.ann), true);
  await assert.rejects(() => u.service.setCourseArchived(u.inst, "nope", true, u.dean), NotFoundError);
});

test("staff can read a join code; faculty and admins can replace it, which revokes the old one", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  assert.equal(await u.service.courseJoinCode(u.inst, cs.id, u.ta), cs.joinCode);
  await assert.rejects(() => u.service.courseJoinCode(u.inst, cs.id, u.ann), AuthorizationError);
  await assert.rejects(() => u.service.courseJoinCode(u.inst, cs.id, u.ta, true), AuthorizationError, "a TA can read but not replace");
  await assert.rejects(() => u.service.courseJoinCode(u.inst, "nope", u.prof), NotFoundError);

  const fresh = await u.service.courseJoinCode(u.inst, cs.id, u.prof, true);
  assert.notEqual(fresh, cs.joinCode);
  await assert.rejects(() => u.service.joinCourse(u.inst, cs.joinCode!, u.ann), ValidationError, "the leaked code is dead");
  assert.equal((await u.service.joinCourse(u.inst, fresh, u.ann)).id, cs.id);
  assert.ok((await u.repo.listAudit(u.inst)).some((e) => e.action === "course.join_code_replaced"));
});

test("a course made before join codes existed gets one the first time staff ask, and keeps it", async () => {
  const u = await university();
  assert.equal((await u.repo.getCourse(u.inst, u.main))!.joinCode, null, "signup doesn't give the main course a code");
  const code = await u.service.courseJoinCode(u.inst, u.main, u.prof);
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(await u.service.courseJoinCode(u.inst, u.main, u.ta), code, "stable on the next ask");
  assert.ok((await u.repo.listAudit(u.inst)).some((e) => e.action === "course.join_code_created"));
});

// ── data stays in its own course ────────────────────────────────────

test("lectures belong to one course: each course lists only its own", async () => {
  const u = await university();
  const cs = await u.service.createCourse(u.inst, { code: "CS101", title: "DS" }, u.prof);
  await releasedLecture(u, cs.id, "cs101-week1");
  await releasedLecture(u, u.main, "main-week1");
  assert.deepEqual((await u.repo.listLecturesByCourse(u.inst, cs.id)).map((l) => l.id), ["cs101-week1"]);
  assert.deepEqual((await u.repo.listLecturesByCourse(u.inst, u.main)).map((l) => l.id), ["main-week1"]);
});

// ── upgrading an existing database ──────────────────────────────────

test("a database from before multi-course upgrades in place: its course keeps working, then gains a code on demand", async () => {
  const file = join(tmpdir(), `lip-courses-${process.pid}-${Date.now()}.sqlite`);
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE courses (id TEXT PRIMARY KEY, institution_id TEXT, code TEXT, title TEXT);
      INSERT INTO courses VALUES ('c-old','inst-old','MAIN','Old Workspace');
    `);
    old.close();

    const repo = new SqliteRepository(file);
    const service = new LectureService(repo);
    await service.seedInstitution(
      { id: "inst-old", name: "Old U", consentPolicy: "all_party", dataRegion: "us-east", retentionDays: 365 },
      { id: "c-old", institutionId: "inst-old", code: "MAIN", title: "Old Workspace" },
    );
    const c = (await repo.getCourse("inst-old", "c-old"))!;
    assert.deepEqual([c.joinCode, c.externalId, c.archived, c.createdBy], [null, null, false, null]);

    const fac: Actor = { id: "f", role: "faculty" };
    const student: Actor = { id: "s", role: "student" };
    assert.equal(await service.canAccessCourse("inst-old", "c-old", student), true, "the old course is still open to everyone");
    const second = await service.createCourse("inst-old", { code: "CS2", title: "Second" }, fac);
    assert.equal(await service.canAccessCourse("inst-old", second.id, student), false);
    assert.match(await service.courseJoinCode("inst-old", "c-old", fac), /^[A-HJ-NP-Z2-9]{8}$/);
    await repo.close();

    new SqliteRepository(file); // and a second start is a no-op, not an error
  } finally {
    rmSync(file, { force: true });
  }
});
