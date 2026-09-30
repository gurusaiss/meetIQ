import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../lib/auth.ts";
import { getRepo, COURSE_ID, COURSE_TITLE } from "../lib/singletons.ts";
import { DeleteLectureForm } from "../components/DeleteLectureForm.tsx";
import { ProcessForm } from "../components/ProcessButton.tsx";
import { LectureStatusBadge } from "../components/Badge.tsx";

export default async function DashboardPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, COURSE_ID);
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);
  const processed = lectures.filter((l) => l.status === "processed").length;
  const waiting = lectures.filter((l) => l.status === "created").length;

  return (
    <>
      <span className="eyebrow">{COURSE_TITLE}</span>
      <h1>Hi {identity.name.split(" ")[0]}, here are your sessions</h1>
      <p className="sub">
        Turn any recorded meeting, lecture, or gathering into a searchable, verified knowledge base.
      </p>

      <div className="stats">
        <div className="stat"><b>{lectures.length}</b><span>Sessions</span></div>
        <div className="stat"><b>{processed}</b><span>Processed &amp; verified</span></div>
        <div className="stat"><b>{waiting}</b><span>Waiting to process</span></div>
      </div>

      <div className="section-title">Sessions</div>
      {lectures.length === 0 && (
        <div className="empty">
          <div className="big">🎙️</div>
          <strong>No sessions yet</strong>
          <div>{canManage ? "Upload your first recording below." : "Your instructor hasn't added a session yet."}</div>
        </div>
      )}

      {lectures.map((l) => (
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
        <>
          <div className="section-title">Add a recording</div>
          <div className="card">
            <h2>🎙️ New session</h2>
            <p className="kpi" style={{ margin: "4px 0 0" }}>
              Upload audio or video. It will be transcribed, turned into notes, flashcards and a quiz,
              and every line verified.
            </p>
            <form action="/lectures" method="post" encType="multipart/form-data">
              <label htmlFor="new-media">Recording (audio or video, max 25 MB)</label>
              <input id="new-media" type="file" name="media" accept="audio/*,video/*" />
              <div className="kpi" style={{ marginTop: 6 }}>
                Optional. Without a file, the built-in sample transcript is used.
              </div>
              <div className="fields">
                <div>
                  <label htmlFor="new-lecture-id">Session id</label>
                  <input
                    id="new-lecture-id"
                    name="lectureId"
                    placeholder="lec-2"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}[a-zA-Z0-9]?"
                    maxLength={64}
                    title="1-64 characters: letters, digits, dot, dash, underscore"
                  />
                </div>
                <div>
                  <label htmlFor="new-capture-source">Capture source</label>
                  <select id="new-capture-source" name="captureSource" defaultValue="upload">
                    <option value="upload">Direct upload</option>
                    <option value="room-capture">Room capture kit</option>
                    <option value="echo360-import">Echo360 import</option>
                    <option value="panopto-import">Panopto import</option>
                  </select>
                </div>
              </div>
              <label className="check" style={{ marginTop: 16 }}>
                <input type="checkbox" name="noticeShown" defaultChecked />
                <span>Recording-consent notice was shown to the room (required in all-party-consent regions)</span>
              </label>
              <div style={{ marginTop: 18 }}>
                <button className="btn">Create session →</button>
              </div>
            </form>
          </div>

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
        </>
      )}
    </>
  );
}
