/**
 * Zero-dependency HTTP server for the Lecture Intelligence UI.
 * Reuses LectureService directly — so the compliance gate, faculty approval
 * gate, and audit trail are the SAME enforced code paths as the tests, not
 * a UI reimplementation.
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
  type Actor,
} from "../services/lecture-service.ts";
import {
  dashboardPage,
  reviewPage,
  studentPage,
  searchPage,
  auditPage,
  layout,
} from "./render.ts";

const INSTITUTION_ID = "inst-a";
const COURSE_ID = "cs101";
const COURSE_TITLE = "CS101 · Data Structures";
// In a real app this comes from the SSO session; hardcoded for the demo UI.
const FACULTY: Actor = { id: "anika", role: "faculty" };

// Persist to a file so state survives restarts.
const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const repo = new SqliteRepository(dataDir + "lip.sqlite");
const service = new LectureService(repo);

// Idempotent seed.
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  const html = (body: string, code = 200) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
  const redirect = (to: string) => {
    res.writeHead(303, { location: to });
    res.end();
  };

  try {
    // ── Dashboard ──
    if (method === "GET" && path === "/") {
      return html(
        dashboardPage(COURSE_TITLE, repo.listLecturesByCourse(INSTITUTION_ID, COURSE_ID)),
      );
    }

    // ── Create lecture ──
    if (method === "POST" && path === "/lectures") {
      const b = await readBody(req);
      const lectureId = (b.get("lectureId") ?? "").trim();
      if (!lectureId) return html(layout("Error", "<h1>Missing lecture id</h1>"), 400);
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

    // ── Process lecture ──
    let m = path.match(/^\/lectures\/([^/]+)\/process$/);
    if (method === "POST" && m) {
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
            ),
            409,
          );
        }
        throw e;
      }
      return redirect(`/lectures/${encodeURIComponent(lectureId)}/review`);
    }

    // ── Faculty review ──
    m = path.match(/^\/lectures\/([^/]+)\/review$/);
    if (method === "GET" && m) {
      const lectureId = decodeURIComponent(m[1]!);
      const lecture = repo.getLecture(INSTITUTION_ID, lectureId);
      if (!lecture) return html(layout("Not found", "<h1>Lecture not found</h1>"), 404);
      return html(reviewPage(lecture, service.reviewQueue(INSTITUTION_ID, lectureId)));
    }

    // ── Student view ──
    m = path.match(/^\/lectures\/([^/]+)\/student$/);
    if (method === "GET" && m) {
      const lectureId = decodeURIComponent(m[1]!);
      const lecture = repo.getLecture(INSTITUTION_ID, lectureId);
      if (!lecture) return html(layout("Not found", "<h1>Lecture not found</h1>"), 404);
      return html(studentPage(lecture, service.studentAssets(INSTITUTION_ID, lectureId)));
    }

    // ── Approve asset (faculty gate) ──
    m = path.match(/^\/assets\/([^/]+)\/approve$/);
    if (method === "POST" && m) {
      const assetId = decodeURIComponent(m[1]!);
      try {
        const approved = service.approveAsset(INSTITUTION_ID, assetId, FACULTY);
        return redirect(`/lectures/${encodeURIComponent(approved.lectureId)}/review`);
      } catch (e) {
        if (e instanceof AuthorizationError) return html(layout("Forbidden", `<h1>${e.message}</h1>`), 403);
        throw e;
      }
    }

    // ── Search ──
    if (method === "GET" && path === "/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const hits = q ? await service.searchCourse(INSTITUTION_ID, COURSE_ID, q, 3) : [];
      return html(searchPage(q, hits));
    }

    // ── Audit ──
    if (method === "GET" && path === "/audit") {
      return html(auditPage(repo.listAudit(INSTITUTION_ID)));
    }

    return html(layout("Not found", "<h1>404</h1><p><a href='/'>Dashboard</a></p>"), 404);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    res.end(layout("Error", `<h1>Server error</h1><pre>${(err as Error).message}</pre>`));
  }
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`Lecture Intelligence UI → http://localhost:${PORT}`);
});
