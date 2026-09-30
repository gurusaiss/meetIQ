/**
 * End-to-end test for the Next.js presentation layer: builds the app, boots
 * it as a real `next start` child process against a throwaway database, and
 * drives the same journey as the zero-dep server's E2E suite (../../test/e2e.test.ts)
 * — login → create → process → approve → student → search → export → audit —
 * asserting the RBAC/approval/compliance gates hold identically, since both
 * presentation layers share the exact same LectureService/SqliteRepository.
 *
 * Two INTENTIONAL, documented differences from the zero-dep server's status
 * codes (both are more-correct HTTP semantics, not regressions):
 *  - Unauthenticated GET-page redirects are 307 (Next's `redirect()` default
 *    for a GET-to-GET redirect), not 303 (which specifically means
 *    "convert POST to GET" and doesn't apply here).
 *  - POST /lectures/[id]/publish redirects to the review page with a
 *    `?published=N` query notice, instead of rendering the review page
 *    inline at 200 — a proper POST-redirect-GET instead of a raw POST render.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 3220;
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

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return (raw.match(/lip_sid=[^;]+/) ?? [""])[0];
}

before(async () => {
  // `next` resolves to a shell/cmd wrapper in node_modules/.bin, not a plain
  // JS file — invoke via npx with shell:true so Windows resolves it correctly.
  const build = spawnSync("npx", ["next", "build"], {
    cwd: webRoot,
    stdio: "inherit",
    shell: true,
  });
  if (build.status !== 0) throw new Error("next build failed");

  dataDir = mkdtempSync(join(tmpdir(), "lip-next-e2e-"));
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: webRoot,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: "ignore",
    shell: true,
  });
  await until(async () => (await fetch(`${BASE}/healthz`)).ok);
});

after(() => {
  // shell:true spawns a shell that then spawns the real `next` process;
  // server.kill() only signals the shell on Windows, leaving the actual
  // server orphaned. Kill the whole process tree by pid instead.
  if (server?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/f", "/t"], { shell: true });
    } else {
      server.kill();
    }
  }
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

test("unauthenticated GET redirects to login (307 — GET-to-GET redirect)", async () => {
  const res = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location") ?? "", /\/login/);
});

test("security headers and CSP nonce are present on every response", async () => {
  const res = await fetch(`${BASE}/login`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /'nonce-[^']+'/);
});

test("an invalid lecture id is rejected with 400", async () => {
  const login = await fetch(`${BASE}/api/login`, {
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

test("an uploaded recording is saved under DATA_DIR/media and used as the mediaRef", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fd = new FormData();
  fd.set("lectureId", "upload-lec");
  fd.set("captureSource", "upload");
  fd.set("noticeShown", "on");
  fd.set("media", new File([bytes], "My Talk.MP3", { type: "audio/mpeg" }));
  const res = await fetch(`${BASE}/lectures`, {
    method: "POST",
    headers: { cookie: faculty },
    body: fd,
    redirect: "manual",
  });
  assert.equal(res.status, 303);
  const saved = join(dataDir, "media", "upload-lec.mp3");
  assert.ok(existsSync(saved), "media file written to disk");
  assert.deepEqual([...readFileSync(saved)], [1, 2, 3, 4, 5]);
});

test("creating a lecture with a duplicate id returns 409, not a raw 500", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  const body = "lectureId=dup-lec&captureSource=upload&noticeShown=on";
  const first = await fetch(`${BASE}/lectures`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: faculty },
    body,
    redirect: "manual",
  });
  assert.equal(first.status, 303);
  const second = await fetch(`${BASE}/lectures`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: faculty },
    body,
    redirect: "manual",
  });
  assert.equal(second.status, 409);
});

test("reprocessing an already-processed lecture returns 409, not a raw 500 that corrupts its status", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  const post = (path: string, body: string) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: faculty },
      body,
      redirect: "manual",
    });
  await post("/lectures", "lectureId=reproc-lec&captureSource=upload&noticeShown=on");
  const firstProcess = await post("/lectures/reproc-lec/process", "diarize=on");
  assert.equal(firstProcess.status, 303);
  const secondProcess = await post("/lectures/reproc-lec/process", "diarize=on");
  assert.equal(secondProcess.status, 409);

  const dashboard = await fetch(`${BASE}/`, { headers: { cookie: faculty } });
  const html = await dashboard.text();
  // React renders "status: " and the value as separate text nodes with
  // hydration comment markers between them, so match loosely rather than
  // on an exact contiguous substring.
  assert.match(
    html,
    /reproc-lec[\s\S]{0,200}status:[\s\S]{0,30}processed/,
    "the earlier successful run's status must survive, not flip to failed",
  );
});

test("full faculty→student journey over HTTP", async () => {
  const login = await fetch(`${BASE}/api/login`, {
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

  assert.equal(
    (await post("/lectures", "lectureId=next-e2e-1&captureSource=upload&noticeShown=on", faculty)).status,
    303,
  );
  assert.equal((await post("/lectures/next-e2e-1/process", "", faculty)).status, 303);

  const studentLogin = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Sam&role=student",
    redirect: "manual",
  });
  const student = cookieFrom(studentLogin);
  const before = await (await fetch(`${BASE}/lectures/next-e2e-1/student`, { headers: { cookie: student } })).text();
  assert.match(before, /No materials have been released/);

  assert.equal((await post("/assets/next-e2e-1:notes:0/approve", "", student)).status, 403);
  assert.equal((await post("/assets/next-e2e-1:notes:0/approve", "", faculty)).status, 303);

  const after_ = await (await fetch(`${BASE}/lectures/next-e2e-1/student`, { headers: { cookie: student } })).text();
  assert.doesNotMatch(after_, /No materials have been released/);
  assert.match(after_, /hash table/i);

  const md = await fetch(`${BASE}/lectures/next-e2e-1/export/notes.md`, { headers: { cookie: student } });
  assert.match(md.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(await md.text(), /Revision Notes/);

  const search = await (await fetch(`${BASE}/search?q=collision`, { headers: { cookie: student } })).text();
  // React's SSR output inserts <!-- --> hydration markers between adjacent
  // text nodes, so "cite " and "seg-3" aren't textually adjacent — allow for that.
  assert.match(search, /cite[\s\S]{0,20}seg-/);

  assert.equal((await fetch(`${BASE}/audit`, { headers: { cookie: student }, redirect: "manual" })).status, 403);
  const adminLogin = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Root&role=admin",
    redirect: "manual",
  });
  const admin = cookieFrom(adminLogin);
  const audit = await (await fetch(`${BASE}/audit`, { headers: { cookie: admin } })).text();
  assert.match(audit, /asset\.approved/);
});

test("publish redirects to review with a notice query string", async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=Anika&role=faculty",
    redirect: "manual",
  });
  const faculty = cookieFrom(login);
  await fetch(`${BASE}/lectures`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: faculty },
    body: "lectureId=next-e2e-2&captureSource=upload&noticeShown=on",
    redirect: "manual",
  });
  await fetch(`${BASE}/lectures/next-e2e-2/process`, {
    method: "POST",
    headers: { cookie: faculty },
    redirect: "manual",
  });
  await fetch(`${BASE}/assets/next-e2e-2:notes:0/approve`, {
    method: "POST",
    headers: { cookie: faculty },
    redirect: "manual",
  });
  const res = await fetch(`${BASE}/lectures/next-e2e-2/publish`, {
    method: "POST",
    headers: { cookie: faculty },
    redirect: "manual",
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location") ?? "", /\/review\?published=1&total=1/);
});
