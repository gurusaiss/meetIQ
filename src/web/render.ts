/**
 * Server-side HTML rendering. Zero-dependency template functions returning
 * strings. Premium-ish, theme-aware (light/dark), accessible. This is the
 * presentation layer; it migrates to Next.js (Phase 10 target) later, but
 * the flows are validated here first, runnably.
 */
import type { StoredAsset, Lecture } from "../persistence/repository.ts";
import type {
  RevisionNotes,
  Quiz,
  Flashcard,
  SearchHit,
} from "../types.ts";
import type { AuditEvent } from "../persistence/repository.ts";
import { config } from "../config.ts";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CSS = `
:root{
  --bg:#f7f8fa; --panel:#ffffff; --ink:#161a22; --muted:#5b6472;
  --line:#e6e8ee; --brand:#4f46e5; --brand-ink:#ffffff;
  --ok:#0f9d58; --warn:#b8860b; --warn-bg:#fff6e0; --danger:#c0392b;
  --chip:#eef0f6;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0d1017; --panel:#151a23; --ink:#e8ebf1; --muted:#9aa4b2;
    --line:#232a36; --brand:#7c74ff; --brand-ink:#0d1017;
    --ok:#3ecf8e; --warn:#e0b341; --warn-bg:#2a2410; --danger:#ff6b6b;
    --chip:#1d2430;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:920px;margin:0 auto;padding:24px 20px 64px}
header.top{display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
header.top .brand{font-weight:700;letter-spacing:-.02em}
header.top nav a{margin-left:16px;color:var(--muted);font-size:14px}
h1{font-size:22px;letter-spacing:-.02em;margin:24px 0 4px}
h2{font-size:16px;margin:24px 0 8px}
.sub{color:var(--muted);margin:0 0 16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;margin:12px 0}
.row{display:flex;gap:12px;align-items:center;justify-content:space-between}
.chip{display:inline-block;background:var(--chip);border-radius:999px;
  padding:2px 10px;font-size:12px;color:var(--muted)}
.badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600}
.b-draft{background:var(--chip);color:var(--muted)}
.b-held{background:var(--warn-bg);color:var(--warn)}
.b-approved{background:rgba(15,157,88,.14);color:var(--ok)}
.btn{display:inline-block;background:var(--brand);color:var(--brand-ink);
  border:0;border-radius:9px;padding:8px 14px;font-size:14px;font-weight:600;cursor:pointer}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn.small{padding:5px 10px;font-size:13px}
input,select{background:var(--panel);color:var(--ink);border:1px solid var(--line);
  border-radius:9px;padding:8px 10px;font-size:14px}
label{font-size:13px;color:var(--muted);display:block;margin:10px 0 4px}
.point{margin:6px 0;padding-left:14px;border-left:3px solid var(--line)}
.point.flagged{border-left-color:var(--warn);background:var(--warn-bg);border-radius:0 8px 8px 0;padding:6px 10px}
.cite{color:var(--muted);font-size:12px}
.flag-tag{color:var(--warn);font-size:12px;font-weight:600;margin-left:6px}
.muted{color:var(--muted)}
.kpi{font-size:13px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
.notice{background:var(--warn-bg);border:1px solid var(--warn);color:var(--warn);
  border-radius:9px;padding:10px 12px;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
`;

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Lecture Intelligence</title><style>${CSS}</style></head>
<body>
<header class="top"><div class="brand">📚 Lecture Intelligence</div>
<nav><a href="/">Dashboard</a><a href="/search">Search</a><a href="/audit">Audit</a></nav></header>
<div class="wrap">${body}</div></body></html>`;
}

function statusBadge(s: string): string {
  const cls = s === "approved" ? "b-approved" : s === "auto_held" ? "b-held" : "b-draft";
  const label = s === "auto_held" ? "auto-held" : s;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function dashboardPage(courseTitle: string, lectures: Lecture[]): string {
  const rows = lectures.length
    ? lectures
        .map(
          (l) => `<div class="card"><div class="row">
        <div><strong>${esc(l.id)}</strong> <span class="chip">${esc(l.captureSource)}</span>
          <div class="kpi">status: ${esc(l.status)} · created ${esc(l.createdAt.slice(0, 16).replace("T", " "))}</div></div>
        <div>${
          l.status === "created"
            ? `<form method="post" action="/lectures/${encodeURIComponent(l.id)}/process" style="display:inline"><button class="btn small">Process</button></form>`
            : `<a class="btn small ghost" href="/lectures/${encodeURIComponent(l.id)}/review">Faculty review</a>
               <a class="btn small ghost" href="/lectures/${encodeURIComponent(l.id)}/student">Student view</a>`
        }</div></div></div>`,
        )
        .join("")
    : `<p class="muted">No lectures yet. Create one below.</p>`;

  return layout(
    "Dashboard",
    `<h1>${esc(courseTitle)}</h1>
     <p class="sub">Turn in-person lecture recordings into study-ready, searchable knowledge.</p>
     ${rows}
     <div class="card">
      <h2 style="margin-top:0">New lecture</h2>
      <form method="post" action="/lectures">
        <label>Lecture id</label>
        <input name="lectureId" placeholder="lec-2" required>
        <label>Capture source</label>
        <select name="captureSource">
          <option value="echo360-import">Echo360 import</option>
          <option value="panopto-import">Panopto import</option>
          <option value="upload">Direct upload</option>
          <option value="room-capture">Room capture kit</option>
        </select>
        <label style="margin-top:12px"><input type="checkbox" name="noticeShown" checked style="width:auto"> Recording-consent notice was shown to the room (required in all-party-consent regions)</label>
        <div style="margin-top:14px"><button class="btn">Create lecture</button></div>
      </form>
     </div>`,
  );
}

function renderNotes(n: RevisionNotes): string {
  return n.topics
    .map(
      (t) => `<div class="card"><div class="row"><strong>${esc(t.title)}</strong>
        <span class="cite">@${fmt(t.start)}</span></div>
      ${t.points
        .map(
          (p) =>
            `<div class="point ${p.flagged ? "flagged" : ""}">${esc(p.text)}
             <span class="cite">[${p.sourceRefs.map(esc).join(", ")}]</span>
             ${p.flagged ? `<span class="flag-tag">⚠ low-confidence audio (${pct(p.confidence)}) — verify</span>` : ""}</div>`,
        )
        .join("")}</div>`,
    )
    .join("");
}

function renderFlashcards(cards: Flashcard[]): string {
  return `<div class="grid">${cards
    .map(
      (c) => `<div class="card"><div class="muted" style="font-size:13px">Q</div>
      <div>${esc(c.front)}</div><hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
      <div class="muted" style="font-size:13px">A ${c.back.flagged ? '<span class="flag-tag">⚠</span>' : ""}</div>
      <div>${esc(c.back.text)}</div>
      <div class="cite" style="margin-top:6px">[${c.back.sourceRefs.map(esc).join(", ")}]</div></div>`,
    )
    .join("")}</div>`;
}

function renderQuiz(q: Quiz): string {
  return q.questions
    .map((qq, i) => {
      const opts = qq.options
        .map(
          (o, j) =>
            `<div class="point">${j === qq.answerIndex ? "✅ " : "○ "}${esc(o)}</div>`,
        )
        .join("");
      return `<div class="card"><strong>Q${i + 1}. ${esc(qq.question)}</strong>
        ${opts}<div class="cite" style="margin-top:8px">Why: ${esc(qq.explanation.text)} [${qq.explanation.sourceRefs.map(esc).join(", ")}]</div></div>`;
    })
    .join("");
}

function assetBlock(a: StoredAsset, showApprove: boolean): string {
  let inner = "";
  if (a.type === "notes") inner = renderNotes(a.content as RevisionNotes);
  else if (a.type === "flashcards") inner = renderFlashcards((a.content as { cards: Flashcard[] }).cards);
  else inner = renderQuiz(a.content as Quiz);

  const approve =
    showApprove && a.status !== "approved"
      ? `<form method="post" action="/assets/${encodeURIComponent(a.id)}/approve" style="display:inline">
           <button class="btn small">Approve &amp; release</button></form>`
      : a.status === "approved"
        ? `<span class="kpi">released to students</span>`
        : "";

  const heldNote =
    a.status === "auto_held"
      ? `<div class="notice">Auto-held for review: ${pct(a.flagRatio)} of statements are low-confidence (far-field audio). Verify flagged items before releasing.</div>`
      : "";

  return `<section><div class="row"><h2>${esc(a.type)} ${statusBadge(a.status)}</h2>${approve}</div>
    <div class="kpi">flagged ${pct(a.flagRatio)} · ungrounded ${pct(a.ungroundedRatio)}</div>
    ${heldNote}${inner}</section>`;
}

export function reviewPage(lecture: Lecture, assets: StoredAsset[]): string {
  return layout(
    "Faculty review",
    `<h1>Faculty review — ${esc(lecture.id)}</h1>
     <p class="sub">Nothing reaches students until you approve it. Low-confidence spans from far-field audio are highlighted.</p>
     ${assets.map((a) => assetBlock(a, true)).join("<hr style='border:0;border-top:1px solid var(--line);margin:20px 0'>")}
     <p style="margin-top:24px"><a href="/">← Dashboard</a></p>`,
  );
}

export function studentPage(lecture: Lecture, assets: StoredAsset[]): string {
  const body = assets.length
    ? assets.map((a) => assetBlock(a, false)).join("<hr style='border:0;border-top:1px solid var(--line);margin:20px 0'>")
    : `<div class="notice">No materials have been released for this lecture yet. Your instructor reviews and approves them first.</div>`;
  return layout(
    "Student view",
    `<h1>${esc(lecture.id)} — study materials</h1>
     <p class="sub">Approved, verified materials from your lecture.</p>
     ${body}
     <p style="margin-top:24px"><a href="/search">Search this course →</a> · <a href="/">← Dashboard</a></p>`,
  );
}

export function searchPage(query: string, hits: SearchHit[]): string {
  const results = query
    ? hits.length
      ? hits
          .map(
            (h) => `<div class="card"><div>${esc(h.chunk.text)}</div>
        <div class="cite" style="margin-top:8px">cite ${h.chunk.segmentIds.map(esc).join(", ")} · @${fmt(h.chunk.start)} · score ${h.score.toFixed(2)}</div></div>`,
          )
          .join("")
      : `<p class="muted">No matches.</p>`
    : `<p class="muted">Ask a question about anything covered in the course.</p>`;
  return layout(
    "Search",
    `<h1>Chat with the course</h1>
     <p class="sub">Semantic search across every lecture, with citations back to the exact moment.</p>
     <form method="get" action="/search"><div class="row">
       <input name="q" value="${esc(query)}" placeholder="e.g. How are collisions handled?" style="flex:1">
       <button class="btn">Search</button></div></form>
     <div style="margin-top:16px">${results}</div>`,
  );
}

export function auditPage(events: AuditEvent[]): string {
  const rows = events
    .map(
      (e) =>
        `<tr><td>${esc(e.ts.slice(0, 19).replace("T", " "))}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td></tr>`,
    )
    .join("");
  return layout(
    "Audit",
    `<h1>Audit trail</h1>
     <p class="sub">Every compliance-relevant action, for the security &amp; privacy officer.</p>
     <div class="card"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
     <tbody>${rows || '<tr><td colspan="4" class="muted">No events yet.</td></tr>'}</tbody></table></div>`,
  );
}

/** exposed for a small banner if needed */
export const flagThreshold = config.quality.confidenceFlagThreshold;
