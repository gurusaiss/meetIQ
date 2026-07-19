/**
 * Zero-dependency HTTP server for the Lecture Intelligence UI.
 * Reuses LectureService directly — so the compliance gate, faculty approval
 * gate, RBAC, retention, and audit trail are the SAME enforced code paths as
 * the tests, not a UI reimplementation.
 *
 *   npm run web   →   http://localhost:3000
 */
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SqliteRepository } from "../persistence/sqlite.ts";
import {
  LectureService,
  ComplianceError,
  AuthorizationError,
} from "../services/lecture-service.ts";
import {
  SessionStore,
  parseCookies,
  hasRole,
  COOKIE_NAME,
  type Identity,
  type Role,
} from "../auth/session.ts";
import {
  dashboardPage,
  reviewPage,
  studentPage,
  searchPage,
  auditPage,
  loginPage,
  layout,
} from "./render.ts";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
} from "../export/exporters.ts";
import type { RevisionNotes, Quiz, Flashcard } from "../types.ts";
import { getCaptureSource } from "../integrations/capture.ts";
import { MockLmsConnector } from "../integrations/lms.ts";

const INSTITUTION_ID = "inst-a";
const COURSE_ID = "cs101";
const COURSE_TITLE = "CS101 · Data Structures";
const ROLES: Role[] = ["student", "faculty", "ta", "admin"];

const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const repo = new SqliteRepository(dataDir + "lip.sqlite");
const service = new LectureService(repo);
const sessions = new SessionStore();
// One mock LMS connector for the process lifetime so pushes accumulate.
const lms = new MockLmsConnector();
// External course identifier as it exists in the LMS/capture system.
const EXTERNAL_COURSE = "CS101-2026S";

service.seedInstitution(
  {
    id: INSTITUTION_ID,
    name: "State University",
    consentPolicy: "all_party",
    dataRegion: "us-east",
    retentionDays: 365,
  },
  { id: COURSE_ID, institutionId: INSTITUTION_ID, code: "CS101", title: COURSE_TITLE },
);

function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

function cookie(token: string, clear = false): string {
  return clear
    ? `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    : `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  const html = (body: string, code = 200, headers: Record<string, string> = {}) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };
  const redirect = (to: string, headers: Record<string, string> = {}) => {
    res.writeHead(303, { location: to, ...headers });
    res.end();
  };
  const forbid = () => html(layout("Forbidden", "<h1>403 — not permitted for your role</h1>"), 403);

  const identity = sessions.get(parseCookies(req.headers.cookie)[COOKIE_NAME])?.identity ?? null;

  try {
    // ── Auth routes (no session required) ──
    if (method === "GET" && path === "/login") {
      return identity ? redirect("/") : html(loginPage());
    }
    if (method === "POST" && path === "/login") {
      const b = await readBody(req);
      const name = (b.get("name") ?? "").trim();
      const role = (b.get("role") ?? "") as Role;
      if (!name || !ROLES.includes(role)) return html(loginPage("Enter a name and valid role."), 400);
      const id: Identity = {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name,
        role,
        institutionId: INSTITUTION_ID,
      };
      const s = sessions.create(id);
      return redirect("/", { "set-cookie": cookie(s.token) });
    }
    if (method === "POST" && path === "/logout") {
      sessions.destroy(parseCookies(req.headers.cookie)[COOKIE_NAME]);
      return redirect("/login", { "set-cookie": cookie("", true) });
    }

    // ── Everything below requires a session ──
    if (!identity) return redirect("/login");

    // ── Dashboard ──
    if (method === "GET" && path === "/") {
      return html(
        dashboardPage(COURSE_TITLE, repo.listLecturesByCourse(INSTITUTION_ID, COURSE_ID), identity),
      );
    }

    // ── Create lecture (faculty/ta/admin) ──
    if (method === "POST" && path === "/lectures") {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      const b = await readBody(req);
      const lectureId = (b.get("lectureId") ?? "").trim();
      if (!lectureId) return html(layout("Error", "<h1>Missing lecture id</h1>", identity), 400);
      service.createLecture({
        institutionId: INSTITUTION_ID,
        courseId: COURSE_ID,
        lectureId,
        mediaRef: `media://${lectureId}`,
        captureSource: b.get("captureSource") ?? "upload",
        consent: { noticeShown: b.get("noticeShown") === "on" },
      });
      return redirect("/");
    }

    // ── Process lecture (faculty/ta/admin) ──
    let m = path.match(/^\/lectures\/([^/]+)\/process$/);
    if (method === "POST" && m) {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      const lectureId = decodeURIComponent(m[1]!);
      try {
        await service.processLecture(INSTITUTION_ID, lectureId, {
          diarize: true,
          speakerHints: { SPEAKER_0: "Prof. Anika", SPEAKER_1: "Student" },
        });
      } catch (e) {
        if (e instanceof ComplianceError) {
          return html(
            layout(
              "Blocked",
              `<h1>Processing blocked</h1><div class="notice">${e.message}</div>
               <p style="margin-top:16px"><a href="/">← Dashboard</a></p>`,
              identity,
            ),
            409,
          );
        }
        throw e;
      }
      return redirect(`/lectures/${encodeURIComponent(lectureId)}/review`);
    }

    // ── Import from capture source (faculty/ta/admin) ──
    if (method === "POST" && path === "/import") {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      await service.importFromCapture(
        INSTITUTION_ID,
        COURSE_ID,
        getCaptureSource("mock"),
        EXTERNAL_COURSE,
        identity,
      );
      return redirect("/");
    }

    // ── Publish approved assets to LMS (faculty/ta/admin) ──
    m = path.match(/^\/lectures\/([^/]+)\/publish$/);
    if (method === "POST" && m) {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      const lectureId = decodeURIComponent(m[1]!);
      const lecture = repo.getLecture(INSTITUTION_ID, lectureId);
      if (!lecture) return html(layout("Not found", "<h1>Lecture not found</h1>", identity), 404);
      const count = await service.publishToLms(
        INSTITUTION_ID,
        lectureId,
        lms,
        EXTERNAL_COURSE,
        identity,
      );
      const notice =
        count > 0
          ? `Published ${count} approved asset(s) to the LMS (mock connector). Total pushed this session: ${lms.published.length}.`
          : `Nothing to publish — approve at least one asset first.`;
      return html(reviewPage(lecture, service.reviewQueue(INSTITUTION_ID, lectureId), identity, notice));
    }

    // ── Delete lecture (faculty/ta/admin) — right to erasure ──
    m = path.match(/^\/lectures\/([^/]+)\/delete$/);
    if (method === "POST" && m) {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      try {
        service.deleteLecture(INSTITUTION_ID, decodeURIComponent(m[1]!), identity);
      } catch (e) {
        if (e instanceof AuthorizationError) return forbid();
        throw e;
      }
      return redirect("/");
    }

    // ── Faculty review (faculty/ta/admin) ──
    m = path.match(/^\/lectures\/([^/]+)\/review$/);
    if (method === "GET" && m) {
      if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbid();
      const lectureId = decodeURIComponent(m[1]!);
      const lecture = repo.getLecture(INSTITUTION_ID, lectureId);
      if (!lecture) return html(layout("Not found", "<h1>Lecture not found</h1>", identity), 404);
      return html(reviewPage(lecture, service.reviewQueue(INSTITUTION_ID, lectureId), identity));
    }

    // ── Student view (any authenticated) ──
    m = path.match(/^\/lectures\/([^/]+)\/student$/);
    if (method === "GET" && m) {
      const lectureId = decodeURIComponent(m[1]!);
      const lecture = repo.getLecture(INSTITUTION_ID, lectureId);
      if (!lecture) return html(layout("Not found", "<h1>Lecture not found</h1>", identity), 404);
      return html(studentPage(lecture, service.studentAssets(INSTITUTION_ID, lectureId), identity));
    }

    // ── Approve asset (faculty/ta) ──
    m = path.match(/^\/assets\/([^/]+)\/approve$/);
    if (method === "POST" && m) {
      const assetId = decodeURIComponent(m[1]!);
      try {
        const approved = service.approveAsset(INSTITUTION_ID, assetId, identity);
        return redirect(`/lectures/${encodeURIComponent(approved.lectureId)}/review`);
      } catch (e) {
        if (e instanceof AuthorizationError) return forbid();
        throw e;
      }
    }

    // ── Export (approved assets only; any authenticated) ──
    m = path.match(/^\/lectures\/([^/]+)\/export\/(notes\.md|flashcards\.csv|quiz\.md)$/);
    if (method === "GET" && m) {
      const lectureId = decodeURIComponent(m[1]!);
      const file = m[2]!;
      const approved = service.studentAssets(INSTITUTION_ID, lectureId);
      const download = (body: string, type: string, name: string) =>
        html(body, 200, {
          "content-type": `${type}; charset=utf-8`,
          "content-disposition": `attachment; filename="${name}"`,
        });
      if (file === "notes.md") {
        const a = approved.find((x) => x.type === "notes");
        if (!a) return html(layout("Not available", "<h1>Notes not released yet</h1>", identity), 404);
        return download(notesToMarkdown(lectureId, a.content as RevisionNotes), "text/markdown", `${lectureId}-notes.md`);
      }
      if (file === "flashcards.csv") {
        const a = approved.find((x) => x.type === "flashcards");
        if (!a) return html(layout("Not available", "<h1>Flashcards not released yet</h1>", identity), 404);
        return download(flashcardsToAnkiCsv((a.content as { cards: Flashcard[] }).cards), "text/csv", `${lectureId}-flashcards.csv`);
      }
      const a = approved.find((x) => x.type === "quiz");
      if (!a) return html(layout("Not available", "<h1>Quiz not released yet</h1>", identity), 404);
      return download(quizToMarkdown(lectureId, a.content as Quiz), "text/markdown", `${lectureId}-quiz.md`);
    }

    // ── Search (any authenticated) ──
    if (method === "GET" && path === "/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const hits = q ? await service.searchCourse(INSTITUTION_ID, COURSE_ID, q, 3) : [];
      return html(searchPage(q, hits, identity));
    }

    // ── Audit (admin only) ──
    if (method === "GET" && path === "/audit") {
      if (!hasRole(identity, ["admin"])) return forbid();
      const inst = repo.getInstitution(INSTITUTION_ID);
      return html(auditPage(repo.listAudit(INSTITUTION_ID), identity, inst?.retentionDays ?? 0));
    }

    // ── Run retention (admin only) ──
    if (method === "POST" && path === "/admin/retention") {
      if (!hasRole(identity, ["admin"])) return forbid();
      try {
        service.runRetention(INSTITUTION_ID, identity);
      } catch (e) {
        if (e instanceof AuthorizationError) return forbid();
        throw e;
      }
      return redirect("/audit");
    }

    return html(layout("Not found", "<h1>404</h1><p><a href='/'>Dashboard</a></p>", identity), 404);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    res.end(layout("Error", `<h1>Server error</h1><pre>${(err as Error).message}</pre>`));
  }
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`Lecture Intelligence UI → http://localhost:${PORT}`);
});
