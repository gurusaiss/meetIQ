/**
 * End-to-end test: boots the real HTTP server as a child process (the actual
 * `npm run web` entrypoint) against a throwaway database, then drives the full
 * journey over HTTP with real session cookies — login → create → process →
 * approve → student view → search → export → audit — asserting the gates hold.
 *
 * This is the Phase 13 E2E gate, automated (previously exercised only by hand).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let server: ChildProcess;
let dataDir: string;

async function until(fn: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

/** Manual cookie handling — capture lip_sid from a 303 and resend it. */
function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return (raw.match(/lip_sid=[^;]+/) ?? [""])[0];
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "lip-e2e-"));
  server = spawn(
    process.execPath,
    ["--experimental-strip-types", "src/web/server.ts"],
    { cwd: repoRoot, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: "ignore" },
  );
  await until(async () => (await fetch(`${BASE}/healthz`)).ok);
});

after(() => {
  server?.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* windows may hold the sqlite handle briefly; best-effort */
  }
});

test("health check reports the datastore is up", async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", db: "ok" });
});

test("security headers are present on every response", async () => {
  const res = await fetch(`${BASE}/login`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=/);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("CSP nonce matches the nonce on the page's inline style/script", async () => {
  const res = await fetch(`${BASE}/login`);
  const csp = res.headers.get("content-security-policy") ?? "";
  const nonce = (csp.match(/'nonce-([^']+)'/) ?? [])[1];
  assert.ok(nonce, "CSP header should carry a nonce");
  const body = await res.text();
  assert.match(body, new RegExp(`<style nonce="${nonce}">`));
});

test("an invalid lecture id is rejected with 400, not silently accepted", async () => {
  const login = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  const res = await fetch(`${BASE}/lectures`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: faculty },
    body: `lectureId=${encodeURIComponent("../etc/passwd")}&captureSource=upload&noticeShown=on`,
    redirect: "manual",
  });
  assert.equal(res.status, 400);
});

test("unauthenticated request redirects to login", async () => {
  const res = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location") ?? "", /\/login/);
});

test("full faculty→student journey over HTTP", async () => {
  // Sign in as faculty.
  const login = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  assert.match(faculty, /lip_sid=/);

  const post = (path: string, body: string, cookie: string) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body,
      redirect: "manual",
    });

  // Create + process a lecture (with consent notice).
  assert.equal((await post("/lectures", "lectureId=e2e-1&captureSource=upload&noticeShown=on", faculty)).status, 303);
  assert.equal((await post("/lectures/e2e-1/process", "", faculty)).status, 303);

  // Student sees nothing before approval.
  const studentLogin = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Sam&role=student",
    redirect: "manual",
  });
  const student = cookieFrom(studentLogin);
  const before = await (await fetch(`${BASE}/lectures/e2e-1/student`, { headers: { cookie: student } })).text();
  assert.match(before, /No materials have been released/);

  // Student cannot approve (403); faculty can.
  assert.equal((await post("/assets/e2e-1:notes:0/approve", "", student)).status, 403);
  assert.equal((await post("/assets/e2e-1:notes:0/approve", "", faculty)).status, 303);

  // Now the student sees the approved notes (real lecture content) and can export.
  const after = await (await fetch(`${BASE}/lectures/e2e-1/student`, { headers: { cookie: student } })).text();
  assert.doesNotMatch(after, /No materials have been released/);
  assert.match(after, /hash table/i);
  const md = await fetch(`${BASE}/lectures/e2e-1/export/notes.md`, { headers: { cookie: student } });
  assert.match(md.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(await md.text(), /Revision Notes/);

  // Search returns a citable hit.
  const search = await (await fetch(`${BASE}/search?q=collision`, { headers: { cookie: student } })).text();
  assert.match(search, /cite seg-/);

  // Audit (admin only): student blocked, admin allowed and sees the events.
  assert.equal((await fetch(`${BASE}/audit`, { headers: { cookie: student }, redirect: "manual" })).status, 403);
  const adminLogin = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Root&role=admin",
    redirect: "manual",
  });
  const admin = cookieFrom(adminLogin);
  const audit = await (await fetch(`${BASE}/audit`, { headers: { cookie: admin } })).text();
  assert.match(audit, /asset.approved/);
});
