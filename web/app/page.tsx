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
      <p className="sub">Turn in-person lecture recordings into study-ready, searchable knowledge.</p>

      {lectures.length === 0 && (
        <p className="muted">No lectures yet.{canManage ? " Create one below." : ""}</p>
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
              <div className="kpi">Pull existing recordings from Echo360/Panopto (moat #4). Demo uses a mock source.</div>
            </div>
            <form action="/import" method="post">
              <button className="btn small">Import from Echo360 (demo)</button>
            </form>
          </div>
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New lecture</h2>
          <form action="/lectures" method="post">
            <label htmlFor="new-lecture-id">Lecture id</label>
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
            <label style={{ marginTop: 12 }}>
              <input type="checkbox" name="noticeShown" defaultChecked style={{ width: "auto" }} /> Recording-consent
              notice was shown to the room (required in all-party-consent regions)
            </label>
            <div style={{ marginTop: 14 }}>
              <button className="btn">Create lecture</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
