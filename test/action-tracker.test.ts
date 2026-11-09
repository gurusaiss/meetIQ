import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import {
  LectureService,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../src/services/lecture-service.ts";
import type { Institution, Course, StoredAsset } from "../src/persistence/repository.ts";
import type { ActionsAndDecisions } from "../src/types.ts";

const INST: Institution = { id: "co-a", name: "Acme", consentPolicy: "single_party", dataRegion: "us-east", retentionDays: 365 };
const COURSE: Course = { id: "c1", institutionId: "co-a", code: "OPS", title: "Ops" };
const MANAGER: Actor = { id: "mia", role: "faculty" };
const HR: Actor = { id: "hal", role: "ta" };
const EMPLOYEE: Actor = { id: "eve", role: "student" };
const AUDITOR: Actor = { id: "audie", role: "auditor" };

async function setup() {
  const repo = new SqliteRepository(":memory:");
  const service = new LectureService(repo);
  await service.seedInstitution(INST, COURSE);
  return { repo, service };
}

/** Process a meeting; returns its assets keyed by type. */
async function meeting(service: LectureService, id: string): Promise<Record<string, StoredAsset>> {
  await service.createLecture({
    institutionId: "co-a", courseId: "c1", lectureId: id, mediaRef: "media://x",
    captureSource: "upload", consent: { noticeShown: true },
  });
  const assets = await service.processLecture("co-a", id, { diarize: true });
  return Object.fromEntries(assets.map((a) => [a.type, a]));
}
const items = (a: StoredAsset) => (a.content as ActionsAndDecisions).actionItems;

test("nothing is tracked until the action items are approved; approving other assets does not leak them", async () => {
  const { service } = await setup();
  const a = await meeting(service, "weekly-1");
  assert.deepEqual(await service.listActionItems("co-a", "c1", MANAGER), []);

  await service.approveAsset("co-a", a.notes!.id, MANAGER);
  assert.deepEqual(await service.listActionItems("co-a", "c1", MANAGER), [], "approved notes are not approved action items");

  await service.approveAsset("co-a", a.actions!.id, MANAGER);
  const tracked = await service.listActionItems("co-a", "c1", MANAGER);
  assert.equal(tracked.length, items(a.actions!).length);
  assert.equal(tracked.length > 0, true);
  const first = tracked[0]!;
  assert.equal(first.lectureId, "weekly-1");
  assert.equal(first.index, 0);
  assert.equal(first.text, items(a.actions!)[0]!.statement.text);
  assert.deepEqual([first.done, first.assignee, first.updatedBy], [false, null, null]);
  assert.equal(first.speaker, items(a.actions!)[0]!.owner, "the transcript speaker is carried as a hint only");
});

test("newest meeting first, items within a meeting in the order they were said", async () => {
  const { service } = await setup();
  const one = await meeting(service, "mtg-old");
  await new Promise((r) => setTimeout(r, 5));
  const two = await meeting(service, "mtg-new");
  await service.approveAsset("co-a", one.actions!.id, MANAGER);
  await service.approveAsset("co-a", two.actions!.id, MANAGER);

  const tracked = await service.listActionItems("co-a", "c1", MANAGER);
  const order = tracked.map((t) => t.lectureId);
  assert.equal(order[0], "mtg-new");
  assert.equal(order[order.length - 1], "mtg-old");
  const newOnes = tracked.filter((t) => t.lectureId === "mtg-new").map((t) => t.index);
  assert.deepEqual(newOnes, [...newOnes].sort((x, y) => x - y));
});

test("staff can assign and complete an item; the tracker and the audit trail both show it", async () => {
  const { service, repo } = await setup();
  const a = await meeting(service, "weekly-1");
  await service.approveAsset("co-a", a.actions!.id, MANAGER);

  await service.updateActionItem("co-a", "weekly-1", 0, { assignee: "  Priya   Nair " }, HR);
  await service.updateActionItem("co-a", "weekly-1", 0, { done: true }, MANAGER);

  const [t0, t1] = await service.listActionItems("co-a", "c1", MANAGER);
  assert.equal(t0!.assignee, "Priya Nair", "whitespace is normalised");
  assert.equal(t0!.done, true);
  assert.equal(t0!.updatedBy, "mia");
  assert.equal(t1?.done ?? false, false, "other items are untouched");

  const events = (await repo.listAudit("co-a")).filter((e) => e.action.startsWith("action_item."));
  assert.deepEqual(events.map((e) => [e.action, e.actor, e.target]), [
    ["action_item.assigned", "hal", "weekly-1#1: Priya Nair"],
    ["action_item.completed", "mia", "weekly-1#1"],
  ]);

  await service.updateActionItem("co-a", "weekly-1", 0, { done: false }, MANAGER);
  assert.equal((await service.listActionItems("co-a", "c1", MANAGER))[0]!.done, false);
  assert.equal((await service.listActionItems("co-a", "c1", MANAGER))[0]!.assignee, "Priya Nair", "reopening keeps the assignee");
});

test("repeating the same update does not spam the audit trail", async () => {
  const { service, repo } = await setup();
  const a = await meeting(service, "weekly-1");
  await service.approveAsset("co-a", a.actions!.id, MANAGER);
  await service.updateActionItem("co-a", "weekly-1", 0, { done: true, assignee: "Priya" }, MANAGER);
  await service.updateActionItem("co-a", "weekly-1", 0, { done: true, assignee: "Priya" }, MANAGER);
  const actions = (await repo.listAudit("co-a")).map((e) => e.action).filter((x) => x.startsWith("action_item."));
  assert.deepEqual(actions.sort(), ["action_item.assigned", "action_item.completed"]);
});

test("employees and auditors can read the tracker but not change it", async () => {
  const { service } = await setup();
  const a = await meeting(service, "weekly-1");
  await service.approveAsset("co-a", a.actions!.id, MANAGER);
  for (const who of [EMPLOYEE, AUDITOR]) {
    await assert.rejects(() => service.updateActionItem("co-a", "weekly-1", 0, { done: true }, who), AuthorizationError, who.role);
  }
  assert.equal((await service.listActionItems("co-a", "c1", EMPLOYEE)).length > 0, true, "reading needs no special role");
});

test("bad updates are refused: unknown lecture, out-of-range or unreleased item, empty patch, overlong name", async () => {
  const { service } = await setup();
  const a = await meeting(service, "weekly-1");
  const n = items(a.actions!).length;

  // Not approved yet: nothing to attach a status to.
  await assert.rejects(() => service.updateActionItem("co-a", "weekly-1", 0, { done: true }, MANAGER), NotFoundError);

  await service.approveAsset("co-a", a.actions!.id, MANAGER);
  await assert.rejects(() => service.updateActionItem("co-a", "nope", 0, { done: true }, MANAGER), NotFoundError);
  for (const bad of [-1, n, 1.5, Number.NaN]) {
    await assert.rejects(() => service.updateActionItem("co-a", "weekly-1", bad, { done: true }, MANAGER), NotFoundError, String(bad));
  }
  await assert.rejects(() => service.updateActionItem("co-a", "weekly-1", 0, {}, MANAGER), ValidationError);
  await assert.rejects(() => service.updateActionItem("co-a", "weekly-1", 0, { assignee: "x".repeat(81) }, MANAGER), ValidationError);

  // A blank assignee clears it.
  await service.updateActionItem("co-a", "weekly-1", 0, { assignee: "Priya" }, MANAGER);
  await service.updateActionItem("co-a", "weekly-1", 0, { assignee: "   " }, MANAGER);
  assert.equal((await service.listActionItems("co-a", "c1", MANAGER))[0]!.assignee, null);
});

test("another organisation neither sees nor can update these items", async () => {
  const { service } = await setup();
  await service.seedInstitution({ ...INST, id: "co-b" }, { ...COURSE, id: "c2", institutionId: "co-b" });
  const a = await meeting(service, "weekly-1");
  await service.approveAsset("co-a", a.actions!.id, MANAGER);

  assert.deepEqual(await service.listActionItems("co-b", "c2", { id: "x", role: "admin" }), []);
  await assert.rejects(() => service.updateActionItem("co-b", "weekly-1", 0, { done: true }, { id: "x", role: "admin" }), NotFoundError);
});

test("deleting a meeting removes its item statuses, and leaves other meetings' alone", async () => {
  const { service, repo } = await setup();
  const one = await meeting(service, "mtg-1");
  const two = await meeting(service, "mtg-2");
  for (const a of [one, two]) await service.approveAsset("co-a", a.actions!.id, MANAGER);
  await service.updateActionItem("co-a", "mtg-1", 0, { done: true }, MANAGER);
  await service.updateActionItem("co-a", "mtg-2", 0, { done: true }, MANAGER);
  assert.equal((await repo.listActionStatuses("co-a")).length, 2);

  await service.deleteLecture("co-a", "mtg-1", MANAGER);
  const left = await repo.listActionStatuses("co-a");
  assert.deepEqual(left.map((s) => s.lectureId), ["mtg-2"]);
  assert.equal((await service.listActionItems("co-a", "c1", MANAGER)).some((t) => t.lectureId === "mtg-1"), false);
});
