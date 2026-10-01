import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../lib/auth.ts";
import { getRepo, COURSE_ID, COURSE_TITLE } from "../lib/singletons.ts";
import { INPUT_TILES, TOOL_TILES, type Tile as TileData } from "../lib/features.ts";
import { Tile } from "../components/Tile.tsx";
import { DeleteLectureForm } from "../components/DeleteLectureForm.tsx";
import { ProcessForm } from "../components/ProcessButton.tsx";
import { LectureStatusBadge } from "../components/Badge.tsx";

const AUDIT_TILE: TileData = {
  key: "audit",
  icon: "🛡️",
  title: "Audit trail",
  desc: "Every approval, export and deletion, plus data retention.",
  from: "#64748b",
  to: "#334155",
};

export default async function HomePage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, COURSE_ID);
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);
  const processed = lectures.filter((l) => l.status === "processed").length;
  const waiting = lectures.filter((l) => l.status === "created").length;
  const visible = canManage ? lectures : lectures.filter((l) => l.status === "processed");

  return (
    <>
      <span className="eyebrow">{COURSE_TITLE}</span>
      <h1>Your workspace</h1>
      <p className="sub">
        Bring in a recording or text, then pick what to make from it. Every line is cited and
        verified.
      </p>

      <div className="stats">
        <div className="stat"><b>{lectures.length}</b><span>Inputs</span></div>
        <div className="stat"><b>{processed}</b><span>Processed &amp; verified</span></div>
        <div className="stat"><b>{waiting}</b><span>Waiting to process</span></div>
      </div>

      {canManage && (
        <>
          <div className="section-title">1 · Add an input</div>
          <div className="tiles">
            {INPUT_TILES.map((t) => (
              <Tile key={t.key} tile={t} href={`/new?mode=${t.key}`} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">{canManage ? "2 · Make something from it" : "What do you want to do?"}</div>
      <div className="tiles">
        {TOOL_TILES.map((t) => (
          <Tile key={t.key} tile={t} href={t.key === "search" ? "/search" : `/pick?feature=${t.key}`} />
        ))}
        {identity.role === "admin" && <Tile tile={AUDIT_TILE} href="/audit" />}
      </div>

      <div className="section-title">Your inputs</div>
      {visible.length === 0 && (
        <div className="empty">
          <div className="big">🎙️</div>
          <strong>No inputs yet</strong>
          <div>{canManage ? "Record, upload or paste something above to get started." : "Your instructor hasn't added anything yet."}</div>
        </div>
      )}

      {visible.map((l) => (
        <div className="card" key={l.id}>
          <div className="session">
            <div>
              <div className="session-id">{l.id}</div>
              <div className="kpi" style={{ marginTop: 4 }}>
                <LectureStatusBadge status={l.status} /> <span className="chip">{l.captureSource}</span> · created{" "}
                {l.createdAt.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div className="actions">
              {l.status === "created" ? (
                <>
                  {canManage && <ProcessForm id={l.id} />}
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              ) : l.status === "failed" || l.status === "processing" ? (
                // Reprocessing in place isn't allowed (see the comment on
                // LectureService.processLecture) — a lecture stuck here
                // (a genuine failure, or a server crash mid-run) can only be
                // recovered by delete + recreate, so don't offer a
                // review/student link into a lecture with no valid content.
                <>
                  <span className="kpi">
                    {l.status === "failed"
                      ? "Processing failed."
                      : "Still processing — if this persists, the run likely crashed."}{" "}
                    {canManage ? "Delete and create it again to retry." : "Ask faculty to retry."}
                  </span>
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              ) : (
                <>
                  {canManage && (
                    <a className="btn small" href={`/lectures/${encodeURIComponent(l.id)}/review`}>
                      Faculty review
                    </a>
                  )}
                  <a className="btn small ghost" href={`/lectures/${encodeURIComponent(l.id)}/student`}>
                    Student view
                  </a>
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {canManage && (
        <div className="card">
          <div className="row">
            <div>
              <strong>Import from capture system</strong>
              <div className="kpi">Pull existing recordings from Echo360/Panopto. Demo uses a mock source.</div>
            </div>
            <form action="/import" method="post">
              <button className="btn small ghost">Import from Echo360 (demo)</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
