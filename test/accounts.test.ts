import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import { AccountService, AccountError, normalizeJoinCode, formatJoinCode } from "../src/auth/accounts.ts";
import { hashPassword, verifyPassword, passwordProblem } from "../src/auth/password.ts";
import { SECTORS, selectableRoles, getSectorRole } from "../src/auth/sectors.ts";

const PW = "Sturdy-pass-9";
const make = () => {
  const repo = new SqliteRepository(":memory:");
  return { repo, accounts: new AccountService(repo) };
};
const create = (a: AccountService, email = "owner@x.test", sector = "uni", roleId = "admin") =>
  a.signUp({ mode: "create", sector, roleId, name: "Owner", email, password: PW, orgName: "Org One" });

test("passwords are hashed with a salt, verify correctly, and weak ones are described", async () => {
  const h1 = await hashPassword(PW);
  const h2 = await hashPassword(PW);
  assert.notEqual(h1, h2, "salted");
  assert.ok(!h1.includes(PW));
  assert.equal(await verifyPassword(PW, h1), true);
  assert.equal(await verifyPassword("nope-nope-1", h1), false);
  assert.equal(await verifyPassword(PW, "garbage"), false);
  assert.ok(passwordProblem("short1"));
  assert.ok(passwordProblem("onlyletters"));
  assert.ok(passwordProblem("12345678"));
  assert.equal(passwordProblem(PW), null);
});

test("sector catalogue: permissions come from base roles, never from titles", () => {
  assert.equal(SECTORS.length, 6);
  for (const s of SECTORS) {
    assert.ok(selectableRoles(s, "create").length > 0, `${s.id} can create an org`);
    assert.ok(selectableRoles(s, "join").length > 0, `${s.id} can join an org`);
    for (const r of selectableRoles(s, "create")) assert.equal(r.base, "admin", `${s.id}/${r.id}`);
    for (const r of selectableRoles(s, "join")) assert.notEqual(r.base, "admin", `${s.id}/${r.id}`);
    assert.equal(new Set(s.roles.map((r) => r.id)).size, s.roles.length, "unique role ids");
  }
  assert.equal(getSectorRole("uni", "dean")?.base, "admin");
  assert.equal(getSectorRole("law", "auditor")?.base, "auditor");
  assert.equal(getSectorRole("org", "hr")?.base, "ta");
});

test("create makes an owner-admin org with an invite code; join adds a lower role in the same tenant", async () => {
  const { accounts, repo } = make();
  const owner = await create(accounts);
  assert.equal(owner.role, "admin");
  assert.equal(owner.owner, true);
  assert.equal(owner.sector, "uni");
  assert.equal(owner.orgName, "Org One");
  const code = await accounts.inviteCodeFor(owner);
  assert.match(code ?? "", /^[A-HJ-NP-Z2-9]{8}$/);

  const joined = await accounts.signUp({
    mode: "join", sector: "uni", roleId: "faculty", name: "Fay", email: "FAY@x.test",
    password: PW, joinCode: formatJoinCode(code!).toLowerCase(),
  });
  assert.equal(joined.role, "faculty");
  assert.equal(joined.owner, false);
  assert.equal(joined.institutionId, owner.institutionId);
  assert.equal(joined.courseId, owner.courseId);
  assert.equal(await accounts.inviteCodeFor(joined), null, "only the owner sees the code");
  assert.equal((await accounts.members(owner)).length, 2);
  const audit = await repo.listAudit(owner.institutionId);
  assert.deepEqual(audit.map((e) => e.action).sort(), ["org.created", "user.joined"]);
});

test("joining cannot grant admin; wrong field or code is rejected with a generic error", async () => {
  const { accounts } = make();
  const owner = await create(accounts);
  const code = (await accounts.inviteCodeFor(owner))!;
  const join = (over: Partial<Parameters<AccountService["signUp"]>[0]>) =>
    accounts.signUp({ mode: "join", sector: "uni", roleId: "student", name: "S", email: "s@x.test", password: PW, joinCode: code, ...over });

  await assert.rejects(join({ roleId: "admin" }), (e: AccountError) => e instanceof AccountError);
  await assert.rejects(join({ roleId: "dean" }), AccountError);
  await assert.rejects(join({ sector: "org", roleId: "employee" }), AccountError);
  await assert.rejects(join({ roleId: "ghost" }), AccountError);
  const bad = await join({ joinCode: "AAAA-AAAA" }).catch((e) => e);
  const wrongSector = await join({ sector: "org", roleId: "employee" }).catch((e) => e);
  assert.equal(bad.status, 404);
  assert.equal(bad.message, wrongSector.message, "doesn't reveal that the code exists in another field");
});

test("validation and duplicates", async () => {
  const { accounts } = make();
  await assert.rejects(create(accounts, "bad"), AccountError);
  await assert.rejects(accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "", email: "a@x.test", password: PW, orgName: "O" }), AccountError);
  await assert.rejects(accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "A", email: "a@x.test", password: "weak", orgName: "O" }), AccountError);
  await assert.rejects(accounts.signUp({ mode: "create", sector: "uni", roleId: "faculty", name: "A", email: "a@x.test", password: PW, orgName: "O" }), AccountError, "non-admin title can't create");
  await assert.rejects(accounts.signUp({ mode: "create", sector: "nope", roleId: "admin", name: "A", email: "a@x.test", password: PW, orgName: "O" }), AccountError);
  await create(accounts, "dup@x.test");
  const dup = await create(accounts, "DUP@x.test").catch((e) => e);
  assert.equal(dup.status, 409);
});

test("sign-in: right password works; wrong password and unknown email give the same error", async () => {
  const { accounts } = make();
  const owner = await create(accounts, "me@x.test");
  const again = await accounts.signIn(" ME@x.test ", PW);
  assert.equal(again.id, owner.id);
  assert.equal(again.owner, true);
  const wrong = await accounts.signIn("me@x.test", "Wrong-pass-1").catch((e) => e);
  const unknown = await accounts.signIn("who@x.test", "Wrong-pass-1").catch((e) => e);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.message, unknown.message);
});

test("organisations are separate tenants with separate courses", async () => {
  const { accounts } = make();
  const a = await create(accounts, "a@x.test");
  const b = await create(accounts, "b@x.test", "org");
  assert.notEqual(a.institutionId, b.institutionId);
  assert.notEqual(a.courseId, b.courseId);
  assert.equal((await accounts.members(a)).length, 1);
  assert.equal(normalizeJoinCode("ab-cd 12"), "ABCD12");
});

test("change password needs the current one; admin reset issues a working temporary password", async () => {
  const { accounts } = make();
  const owner = await create(accounts);
  const code = (await accounts.inviteCodeFor(owner))!;
  const member = await accounts.signUp({ mode: "join", sector: "uni", roleId: "student", name: "Sam", email: "sam@x.test", password: PW, joinCode: code });

  await assert.rejects(accounts.changePassword(member, "wrong-pass-1", "Another-pass-2"), (e: unknown) => e instanceof AccountError && e.status === 401);
  await assert.rejects(accounts.changePassword(member, PW, "weak"), (e: unknown) => e instanceof AccountError && e.status === 400);
  await accounts.changePassword(member, PW, "Another-pass-2");
  await assert.rejects(accounts.signIn("sam@x.test", PW));
  await accounts.signIn("sam@x.test", "Another-pass-2");

  await assert.rejects(accounts.resetMemberPassword(member, "owner@x.test"), (e: unknown) => e instanceof AccountError && e.status === 403);
  await assert.rejects(accounts.resetMemberPassword(owner, "owner@x.test"), (e: unknown) => e instanceof AccountError && e.status === 400);
  await assert.rejects(accounts.resetMemberPassword(owner, "ghost@x.test"), (e: unknown) => e instanceof AccountError && e.status === 404);
  const r = await accounts.resetMemberPassword(owner, "sam@x.test");
  assert.equal(passwordProblem(r.temporary), null);
  await assert.rejects(accounts.signIn("sam@x.test", "Another-pass-2"));
  await accounts.signIn("sam@x.test", r.temporary);
});
