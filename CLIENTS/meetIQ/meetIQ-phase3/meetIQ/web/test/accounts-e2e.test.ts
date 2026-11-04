/**
 * End-to-end tests for accounts, sectors and roles: builds nothing itself
 * (run after `next build`; the main e2e suite builds), boots its own
 * `next start` on a separate port against a throwaway database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3221;
const BASE = `http://localhost:${PORT}`;
const webRoot = fileURLToPath(new URL("..", import.meta.url));
let server: ChildProcess;
let dataDir: string;

async function until(fn: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not become ready");
}

const cookieFrom = (res: Response) => ((res.headers.get("set-cookie") ?? "").match(/lip_sid=[^;]+/) ?? [""])[0];

before(async () => {
  if (!existsSync(join(webRoot, ".next", "BUILD_ID"))) {
    const build = spawnSync("npx", ["next", "build"], { cwd: webRoot, stdio: "inherit", shell: true });
    if (build.status !== 0) throw new Error("next build failed");
  }
  dataDir = mkdtempSync(join(tmpdir(), "lip-next-acct-"));
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: webRoot,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: "ignore",
    shell: true,
  });
  await until(async () => (await fetch(`${BASE}/healthz`)).ok);
});

after(() => {
  if (server?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/f", "/t"], { shell: true });
    else server.kill();
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const postForm = (path: string, fields: Record<string, string>, cookie = "") =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
const get = (path: string, cookie: string) => fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
const loc = (r: Response) => decodeURIComponent(r.headers.get("location") ?? "");
const PW = "Sturdy-pass-9";

async function signUp(fields: Record<string, string>) {
  const res = await postForm("/api/signup", { password: PW, mode: "create", roleId: "admin", ...fields });
  return { res, cookie: cookieFrom(res) };
}
async function inviteCode(cookie: string): Promise<string> {
  const html = await (await get("/team", cookie)).text();
  const m = html.match(/class="invite-code"[^>]*>([A-Z2-9-]+)</);
  assert.ok(m, "invite code shown to the organisation owner");
  return m[1]!;
}
const joinWith = (sector: string, code: string, roleId: string, email: string) =>
  postForm("/api/signup", { sector, mode: "join", roleId, name: `${roleId} person`, email, password: PW, joinCode: code });
const mkLecture = (cookie: string, id: string) =>
  postForm("/lectures", { lectureId: id, captureSource: "upload", noticeShown: "on" }, cookie);

test("sign-up creates an organisation and signs the owner in as its administrator", async () => {
  const { res, cookie } = await signUp({ sector: "uni", name: "Priya Nair", email: "priya@alpha.test", orgName: "Alpha University" });
  assert.equal(res.status, 303);
  assert.match(loc(res), /\/\?welcome=1/);
  assert.match(cookie, /lip_sid=/);
  const home = await (await get("/", cookie)).text();
  assert.match(home, /Alpha University/);
  assert.match(home, /Invite your team/);
  assert.match(home, /href="\/approvals"/);
  assert.match(home, /href="\/team"/);
});

test("sign-up validation: weak password, bad email, duplicate email, unknown field, wrong code", async () => {
  const weak = await signUp({ sector: "uni", name: "W", email: "weak@alpha.test", orgName: "Weak U", password: "short" });
  assert.match(loc(weak.res), /\/signup\/uni\?/);
  assert.match(loc(weak.res), /error=/);
  assert.equal(weak.cookie, "");
  assert.doesNotMatch(loc(weak.res), /password=|short/, "password is never echoed back");

  const badEmail = await signUp({ sector: "uni", name: "B", email: "not-an-email", orgName: "Bad Mail U" });
  assert.match(loc(badEmail.res), /error=/);
  assert.equal(badEmail.cookie, "");

  await signUp({ sector: "org", name: "Dup One", email: "dup@beta.test", orgName: "Beta Corp" });
  const dup = await signUp({ sector: "org", name: "Dup Two", email: "DUP@beta.test", orgName: "Beta Two" });
  assert.match(loc(dup.res), /already[s+]exists/);
  assert.equal(dup.cookie, "");

  const sector = await signUp({ sector: "nope", name: "S", email: "s@alpha.test", orgName: "X" });
  assert.match(loc(sector.res), /\/signup\?/);

  const code = await joinWith("uni", "ZZZZ-ZZZZ", "student", "j@alpha.test");
  assert.match(loc(code), /error=/);
  assert.equal(cookieFrom(code), "");
});

test("invite code joins the organisation; joining can never make you an administrator", async () => {
  const owner = (await signUp({ sector: "uni", name: "Owner", email: "owner@gamma.test", orgName: "Gamma University" })).cookie;
  const code = await inviteCode(owner);

  const sneaky = await joinWith("uni", code, "admin", "sneaky@gamma.test");
  assert.equal(cookieFrom(sneaky), "", "admin title is not selectable via an invite code");
  assert.match(loc(sneaky), /error=/);
  const dean = await joinWith("uni", code, "dean", "dean@gamma.test");
  assert.equal(cookieFrom(dean), "", "dean has admin permissions so it can't be joined either");
  const wrongField = await joinWith("org", code, "employee", "ws@gamma.test");
  assert.equal(cookieFrom(wrongField), "", "a code only works for its own field");

  const fac = await joinWith("uni", code, "faculty", "fac@gamma.test");
  assert.equal(fac.status, 303);
  const student = await joinWith("uni", code.replace("-", "").toLowerCase(), "student", "stu@gamma.test");
  assert.equal(student.status, 303, "codes are accepted lowercase and without the dash");

  const team = await (await get("/team", owner)).text();
  assert.match(team, /fac@gamma\.test/);
  assert.match(team, /stu@gamma\.test/);
  assert.equal((await get("/team", cookieFrom(fac))).status, 403);
  assert.equal((await get("/team", cookieFrom(student))).status, 403);
});

test("sign-in works; wrong credentials fail without revealing which part was wrong", async () => {
  await signUp({ sector: "uni", name: "Sia", email: "sia@delta.test", orgName: "Delta U" });
  const ok = await postForm("/api/signin", { email: "SIA@delta.test", password: PW });
  assert.equal(ok.status, 303);
  assert.match(cookieFrom(ok), /lip_sid=/);
  const wrong = await postForm("/api/signin", { email: "sia@delta.test", password: "Wrong-pass-1" });
  const unknown = await postForm("/api/signin", { email: "nobody@delta.test", password: "Wrong-pass-1" });
  assert.equal(cookieFrom(wrong), "");
  assert.equal(cookieFrom(unknown), "");
  const msg = (r: Response) => new URL(r.headers.get("location") ?? "", BASE).searchParams.get("error");
  assert.ok(msg(wrong));
  assert.equal(msg(wrong), msg(unknown));
  const login = await (await fetch(`${BASE}/login?error=${encodeURIComponent("Wrong email or password.")}`)).text();
  assert.match(login, /Wrong email or password/);
});

test("two organisations cannot see each other's data", async () => {
  const a = (await signUp({ sector: "uni", name: "A Admin", email: "a@iso.test", orgName: "Iso A" })).cookie;
  const b = (await signUp({ sector: "org", name: "B Admin", email: "b@iso.test", orgName: "Iso B" })).cookie;
  assert.equal((await mkLecture(a, "iso-a")).status, 303);
  assert.equal((await mkLecture(b, "iso-b")).status, 303);
  assert.equal((await postForm("/lectures/iso-a/process", {}, a)).status, 303);

  assert.equal((await get("/lectures/iso-a/review", a)).status, 200);
  assert.equal((await get("/lectures/iso-a/review", b)).status, 404, "B cannot open A's lecture");
  assert.notEqual((await postForm("/lectures/iso-a/process", {}, b)).status, 303);
  assert.notEqual((await postForm("/lectures/iso-a/delete", {}, b)).status, 303);

  const homeB = await (await get("/", b)).text();
  assert.doesNotMatch(homeB, /iso-a/);
  assert.match(homeB, /iso-b/);
  assert.match(homeB, /Iso B/);
  assert.doesNotMatch(await (await get("/audit", b)).text(), /iso-a/);
  assert.match(await (await get("/", a)).text(), /classes/i, "university wording");
  assert.match(homeB, /meetings/i, "organisation wording");
});

test("role gates: faculty-level, student-level, admin and read-only auditor", async () => {
  const owner = (await signUp({ sector: "law", name: "Partner", email: "p@law.test", orgName: "Law & Co", roleId: "partner" })).cookie;
  const code = await inviteCode(owner);
  const associate = cookieFrom(await joinWith("law", code, "associate", "assoc@law.test"));
  const auditor = cookieFrom(await joinWith("law", code, "auditor", "aud@law.test"));
  const client = cookieFrom(await joinWith("law", code, "client", "client@law.test"));
  for (const c of [associate, auditor, client]) assert.match(c, /lip_sid=/);

  assert.equal((await mkLecture(associate, "law-1")).status, 303);
  assert.equal((await postForm("/lectures/law-1/process", {}, associate)).status, 303);
  assert.equal((await get("/approvals", associate)).status, 200);
  assert.equal((await get("/audit", associate)).status, 403);
  assert.equal((await get("/team", associate)).status, 403);

  assert.equal((await mkLecture(client, "law-2")).status, 403);
  assert.equal((await postForm("/assets/law-1:notes:0/approve", {}, client)).status, 403);
  for (const p of ["/approvals", "/audit", "/team", "/new", "/lectures/law-1/review"]) {
    assert.equal((await get(p, client)).status, 403, p);
  }

  const audit = await get("/audit", auditor);
  assert.equal(audit.status, 200);
  const auditHtml = await audit.text();
  assert.match(auditHtml, /Read-only access/);
  assert.doesNotMatch(auditHtml, /Run retention now/);
  assert.match(auditHtml, /user\.joined/);
  assert.equal((await postForm("/admin/retention", {}, auditor)).status, 403);
  assert.equal((await mkLecture(auditor, "law-3")).status, 403);
  assert.equal((await postForm("/assets/law-1:notes:0/approve", {}, auditor)).status, 403);
  assert.equal((await get("/approvals", auditor)).status, 403);

  assert.equal((await get("/audit", owner)).status, 200);
  assert.ok((await postForm("/admin/retention", {}, owner)).status < 400);
});

test("quick-demo sign-in still works for every role incl. auditor, and rejects bad input", async () => {
  for (const role of ["faculty", "ta", "student", "admin", "auditor"]) {
    const r = await postForm("/api/login", { name: `Demo ${role}`, role });
    assert.equal(r.status, 303, role);
    assert.match(cookieFrom(r), /lip_sid=/, role);
  }
  const bad = await postForm("/api/login", { name: "X", role: "root" });
  assert.match(loc(bad), /\/login\?error=/);
});

test("every link on each role's home page resolves (no dead buttons)", async () => {
  const owner = (await signUp({ sector: "train", name: "Crawl Admin", email: "c@train.test", orgName: "Crawl Training" })).cookie;
  await mkLecture(owner, "crawl-1");
  await postForm("/lectures/crawl-1/process", {}, owner);
  await postForm("/assets/crawl-1:notes:0/approve", {}, owner);
  const code = await inviteCode(owner);
  const learner = cookieFrom(await joinWith("train", code, "learner", "l@train.test"));
  const trainer = cookieFrom(await joinWith("train", code, "trainer", "t@train.test"));

  for (const [who, cookie] of [["admin", owner], ["trainer", trainer], ["learner", learner]] as const) {
    const html = await (await get("/", cookie)).text();
    const links = new Set<string>();
    for (const m of html.matchAll(/href="(\/[^"#]*)(?:#[^"]*)?"/g)) links.add(m[1]!.replace(/&amp;/g, "&"));
    assert.ok(links.size >= 3, `${who} sees links`);
    for (const l of links) {
      if (l.startsWith("/_next") || l.startsWith("/api/")) continue;
      const r = await get(l, cookie);
      assert.ok(r.status < 400, `${who}: GET ${l} -> ${r.status}`);
    }
  }
  const learnerHome = await (await get("/", learner)).text();
  assert.doesNotMatch(learnerHome, /href="\/new\?mode=/);
  assert.doesNotMatch(learnerHome, /href="\/audit"/);
  const adminHome = await (await get("/", owner)).text();
  assert.match(adminHome, /href="\/new\?mode=record"/);
  assert.match(adminHome, /href="\/audit"/);
  assert.match(adminHome, /href="\/team"/);
});

test("sign-up pages render for every field and show server errors", async () => {
  const index = await (await fetch(`${BASE}/signup`)).text();
  for (const s of ["uni", "org", "law", "med", "train", "gov"]) {
    assert.match(index, new RegExp(`href="/signup/${s}"`), s);
    const page = await fetch(`${BASE}/signup/${s}?error=${encodeURIComponent("Something specific.")}`);
    assert.equal(page.status, 200, s);
    assert.match(await page.text(), /Something specific/, s);
  }
  const unknown = await fetch(`${BASE}/signup/not-a-field`, { redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(unknown.status));
});
