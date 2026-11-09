import { redirect, notFound, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../../lib/auth.ts";
import { getRepo, getService } from "../../../lib/singletons.ts";
import { groupNoun } from "../../../lib/features.ts";
import { formatJoinCode } from "../../../../src/auth/accounts.ts";
import { CopyCode } from "../../../components/CopyCode.tsx";

export const metadata = { title: "Manage course · MeetIQ" };

export default async function ManageCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; done?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["faculty", "ta", "admin"])) forbidden();
  const { id } = await params;
  const { created, done } = await searchParams;
  const one = groupNoun(identity);
  const svc = getService();

  const course = await getRepo().getCourse(identity.institutionId, id);
  if (!course) notFound();
  const canManage = hasRole(identity, ["faculty", "admin"]);
  const isAdmin = identity.role === "admin";
  const isMain = id === (await svc.defaultCourseId(identity.institutionId));
  const code = await svc.courseJoinCode(identity.institutionId, id, identity);
  const roster = await svc.courseRoster(identity.institutionId, id, identity);
  const action = `/courses/${encodeURIComponent(id)}/manage`;

  return (
    <>
      <span className="eyebrow">{identity.orgName} · {course.code}</span>
      <h1>{course.title}</h1>
      <p className="sub">
        {course.archived ? "Archived: hidden from students and closed to new enrolment. " : ""}
        Share the code below so students can join this {one}.
      </p>

      {created && <div className="notice ok" role="status">Created. You&apos;re now in this {one}.</div>}
      {done && !created && <div className="notice ok" role="status">Saved.</div>}

      <div className="card highlight">
        <div className="row">
          <div>
            <strong>Join code</strong>
            <div className="kpi">Students enter this under &ldquo;Join a {one}&rdquo;. Replace it if it has been shared too widely.</div>
          </div>
          <CopyCode code={formatJoinCode(code)} />
        </div>
        {canManage && (
          <form action={action} method="post" style={{ marginTop: 10 }}>
            <input type="hidden" name="intent" value="newcode" />
            <button className="btn small ghost">Replace code</button>
          </form>
        )}
      </div>

      {canManage && (
        <div className="card">
          <form action={action} method="post">
            <input type="hidden" name="intent" value="update" />
            <div className="fields">
              <div>
                <label htmlFor="e-code">Code</label>
                <input id="e-code" name="code" required maxLength={24} defaultValue={course.code} />
              </div>
              <div>
                <label htmlFor="e-title">Title</label>
                <input id="e-title" name="title" required maxLength={80} defaultValue={course.title} />
              </div>
            </div>
            <label htmlFor="e-ext">LMS / capture id</label>
            <input id="e-ext" name="externalId" maxLength={120} defaultValue={course.externalId ?? ""} placeholder="Canvas course id or SIS id" />
            <div style={{ marginTop: 14 }}>
              <button className="btn small">Save changes</button>
            </div>
          </form>
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <div className="row">
            <div>
              <strong>{course.archived ? "Restore this " + one : "Archive this " + one}</strong>
              <div className="kpi">
                {isMain
                  ? `This is the organisation's main ${one}: everyone can always reach it, so it can't be archived.`
                  : course.archived
                    ? "Bring it back for students. Their enrolments are kept."
                    : "Hide it from students and stop new enrolment. Recordings and enrolments are kept."}
              </div>
            </div>
            <form action={action} method="post">
              <input type="hidden" name="intent" value={course.archived ? "restore" : "archive"} />
              <button className="btn small ghost" disabled={isMain && !course.archived}>{course.archived ? "Restore" : "Archive"}</button>
            </form>
          </div>
        </div>
      )}

      <div className="section-title">Enrolled · {roster.length}</div>
      <div className="card">
        {roster.length === 0 ? (
          <p className="muted">
            {isMain
              ? `Nobody has enrolled by code here. Everyone in the organisation can already reach this main ${one}.`
              : "Nobody has enrolled yet. Share the code above."}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Enrolled</th><th></th></tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.name ?? r.userId}</td>
                    <td>{r.email ?? "—"}</td>
                    <td>{r.enrolledAt.slice(0, 10)}</td>
                    <td>
                      {canManage && (
                        <form action={action} method="post">
                          <input type="hidden" name="intent" value="remove" />
                          <input type="hidden" name="userId" value={r.userId} />
                          <button className="btn small ghost">Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="kpi" style={{ marginTop: 10 }}>
          Staff can always open every {one}, so they aren&apos;t listed here.
        </div>
      </div>

      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href="/courses">← All {groupNoun(identity, true)}</a>
      </p>
    </>
  );
}
