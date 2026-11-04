import { redirect, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, getService } from "../../lib/singletons.ts";
import { noun } from "../../lib/features.ts";

export const metadata = { title: "Approvals · MeetIQ" };

export default async function ApprovalsPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["faculty", "ta", "admin"])) forbidden();

  const lectures = (await getRepo().listLecturesByCourse(identity.institutionId, identity.courseId!)).filter(
    (l) => l.status === "processed",
  );
  const rows = await Promise.all(
    lectures.map(async (l) => {
      const assets = await getService().reviewQueue(identity.institutionId, l.id);
      const approved = assets.filter((a) => a.status === "approved").length;
      return { id: l.id, total: assets.length, approved, waiting: assets.length - approved };
    }),
  );
  rows.sort((a, b) => b.waiting - a.waiting);
  const waitingTotal = rows.reduce((n, r) => n + r.waiting, 0);

  return (
    <>
      <span className="eyebrow">Oversight</span>
      <h1>Approvals</h1>
      <p className="sub">
        Nothing reaches your {noun(identity, true)} audience until it&apos;s approved here.{" "}
        {waitingTotal > 0 ? `${waitingTotal} item(s) are waiting.` : "You're all caught up."}
      </p>

      {rows.length === 0 && (
        <div className="empty">
          <strong>Nothing to review</strong>
          <div>Process a {noun(identity)} first and its generated material will show up here.</div>
        </div>
      )}

      {rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="session">
            <div>
              <div className="session-id">{r.id}</div>
              <div className="kpi" style={{ marginTop: 4 }}>
                {r.waiting > 0 ? (
                  <span className="badge b-held">{r.waiting} waiting</span>
                ) : (
                  <span className="badge b-approved">All approved</span>
                )}{" "}
                {r.approved} of {r.total} approved
              </div>
            </div>
            <div className="actions">
              <a className="btn small" href={`/lectures/${encodeURIComponent(r.id)}/review`}>
                {r.waiting > 0 ? "Review" : "Open"}
              </a>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
