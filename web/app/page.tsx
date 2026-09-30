import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../lib/auth.ts";
import { getRepo, COURSE_ID, COURSE_TITLE } from "../lib/singletons.ts";
import { DeleteLectureForm } from "../components/DeleteLectureForm.tsx";

export default async function DashboardPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, COURSE_ID);
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);

  return (
    <>
      <h1>{COURSE_TITLE}</h1>
      <p className="sub">Turn any recorded meeting, lecture, or gathering into a searchable, verified knowledge base.</p>

      {lectures.length === 0 && (
        <p className="muted">No sessions yet.{canManage ? " Create one below." : ""}</p>
      )}

      {lectures.map((l) => (
        <div className="card" key={l.id}>
          <div className="row">
            <div>
              <strong>{l.id}</strong> <span className="chip">{l.captureSource}</span>
              <div className="kpi">
                status: {l.status} · created {l.createdAt.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div>
              {l.status === "created" ? (
                <>
                  {canManage && (
                    <form action={`/lectures/${encodeURIComponent(l.id)}/process`} method="post" style={{ display: "inline" }}>
                      <button className="btn small">Process</button>
                    </form>
                  )}{" "}
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
                  </span>{" "}
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              ) : (
                <>
                  {canManage && (
                    <a className="btn small ghost" href={`/lectures/${encodeURIComponent(l.id)}/review`}>
                      Faculty review
                    </a>
                  )}{" "}
                  <a className="btn small ghost" href={`/lectures/${encodeURIComponent(l.id)}/student`}>
                    Student view
                  </a>{" "}
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
              <button className="btn small">Import from Echo360 (demo)</button>
            </form>
          </div>
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New session</h2>
          <form action="/lectures" method="post" encType="multipart/form-data">
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
            <label htmlFor="new-capture-source">Capture source</label>
            <select id="new-capture-source" name="captureSource" defaultValue="echo360-import">
              <option value="echo360-import">Echo360 import</option>
              <option value="panopto-import">Panopto import</option>
              <option value="upload">Direct upload</option>
              <option value="room-capture">Room capture kit</option>
            </select>
            <label htmlFor="new-media">Recording (audio or video, max 25 MB)</label>
            <input id="new-media" type="file" name="media" accept="audio/*,video/*" />
            <div className="kpi">Optional — without a file, the built-in sample transcript is used.</div>
            <label style={{ marginTop: 12 }}>
              <input type="checkbox" name="noticeShown" defaultChecked style={{ width: "auto" }} /> Recording-consent
              notice was shown to the room (required in all-party-consent regions)
            </label>
            <div style={{ marginTop: 14 }}>
              <button className="btn">Create session</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
