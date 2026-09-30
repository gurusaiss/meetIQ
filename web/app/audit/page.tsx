import { redirect, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, INSTITUTION_ID } from "../../lib/singletons.ts";

export default async function AuditPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["admin"])) forbidden();
  const repo = getRepo();

  const events = await repo.listAudit(INSTITUTION_ID);
  const inst = await repo.getInstitution(INSTITUTION_ID);

  return (
    <>
      <span className="eyebrow">Compliance</span>
      <h1>Audit trail</h1>
      <p className="sub">Every compliance-relevant action, for the security &amp; privacy officer.</p>
      <div className="card">
        <div className="row">
          <div>
            <strong>Data retention</strong>
            <div className="kpi">
              Tenant policy: delete sessions older than {inst?.retentionDays ?? 0} days.
            </div>
          </div>
          <form action="/admin/retention" method="post">
            <button className="btn small">Run retention now</button>
          </form>
        </div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No events yet.
                </td>
              </tr>
            ) : (
              events.map((e, i) => (
                <tr key={i}>
                  <td>{e.ts.slice(0, 19).replace("T", " ")}</td>
                  <td>{e.actor}</td>
                  <td>{e.action}</td>
                  <td>{e.target}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
