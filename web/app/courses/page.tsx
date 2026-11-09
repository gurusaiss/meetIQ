import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getService } from "../../lib/singletons.ts";
import { groupNoun } from "../../lib/features.ts";

export const metadata = { title: "Courses · MeetIQ" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { error } = await searchParams;
  const one = groupNoun(identity);
  const many = groupNoun(identity, true);
  const isStaff = hasRole(identity, ["faculty", "ta", "admin"]);
  const canCreate = hasRole(identity, ["faculty", "admin"]);

  const courses = await getService().accessibleCourses(identity.institutionId, identity);

  return (
    <>
      <span className="eyebrow">{identity.orgName}</span>
      <h1>{cap(many)}</h1>
      <p className="sub">
        Each {one} keeps its own recordings, notes, search and action items.
        {isStaff
          ? ` Staff can open any ${one}; students see the ones they've enrolled in.`
          : ` You can open the ${many} you've enrolled in. Ask your instructor for a code to join another.`}
      </p>

      {error && <div className="notice" role="alert">{error}</div>}

      {courses.map((c) => {
        const current = c.id === identity.courseId;
        return (
          <div className={`card${current ? " highlight" : ""}`} key={c.id}>
            <div className="row">
              <div>
                <strong>{c.title}</strong> <span className="chip">{c.code}</span>
                {c.archived && <span className="badge b-held" style={{ marginLeft: 6 }}>archived</span>}
                {current && <span className="badge b-approved" style={{ marginLeft: 6 }}>current</span>}
              </div>
              <div className="actions">
                {!current && (
                  <form action="/courses/switch" method="post">
                    <input type="hidden" name="courseId" value={c.id} />
                    <button className="btn small">Open</button>
                  </form>
                )}
                {isStaff && <a className="btn small ghost" href={`/courses/${encodeURIComponent(c.id)}`}>Manage</a>}
              </div>
            </div>
          </div>
        );
      })}

      <div className="section-title">Join a {one}</div>
      <div className="card">
        <form action="/courses/join" method="post">
          <label htmlFor="join-code">Code from your instructor</label>
          <div className="row" style={{ justifyContent: "flex-start", flexWrap: "nowrap" }}>
            <input id="join-code" name="code" required maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-EFGH" style={{ maxWidth: 260, textTransform: "uppercase" }} />
            <button className="btn small">Join</button>
          </div>
        </form>
      </div>

      {canCreate && (
        <>
          <div className="section-title">Create a {one}</div>
          <div className="card">
            <form action="/courses/create" method="post">
              <div className="fields">
                <div>
                  <label htmlFor="c-code">Code</label>
                  <input id="c-code" name="code" required maxLength={24} placeholder="CS101" />
                </div>
                <div>
                  <label htmlFor="c-title">Title</label>
                  <input id="c-title" name="title" required maxLength={80} placeholder="Data Structures" />
                </div>
              </div>
              <label htmlFor="c-ext">LMS / capture id (optional)</label>
              <input id="c-ext" name="externalId" maxLength={120} placeholder="Canvas course id or SIS id, e.g. 48213 or CS101-2026S" />
              <div className="kpi" style={{ marginTop: 6 }}>
                Used when publishing to your LMS and importing recordings for this {one}. Leave blank to use the organisation-wide default.
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="btn">Create {one}</button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
