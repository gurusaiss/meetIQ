import { redirect, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, getService } from "../../lib/singletons.ts";

export const metadata = { title: "Audit trail · MeetIQ" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ purged?: string; held?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["admin", "auditor"])) forbidden();
  const { purged, held } = await searchParams;
  const canRetain = identity.role === "admin";

  const { events, verification: v } = await getService().auditTrail(identity.institutionId, identity);
  const inst = await getRepo().getInstitution(identity.institutionId);

  return (
    <>
      <span className="eyebrow">Compliance</span>
      <h1>Audit trail</h1>
      <p className="sub">Every compliance-relevant action, for the security &amp; privacy officer.</p>

      {purged !== undefined && (
        <div className="notice ok" role="status">
          Retention run: {purged} purged
          {Number(held) > 0 ? `, ${held} left alone because they are under legal hold` : ""}.
        </div>
      )}

      {v.ok ? (
        <div className="notice ok" role="status">
          <strong>Chain verified.</strong> {v.chained} event{v.chained === 1 ? "" : "s"} check out, each linked to the one before
          {v.legacy > 0 ? `; ${v.legacy} older event${v.legacy === 1 ? "" : "s"} from before the chain existed can't be verified` : ""}.
          {v.head && (
            <div className="kpi" style={{ marginTop: 6 }}>
              Head <code>{v.head.slice(0, 16)}…</code> — record this somewhere outside the system: it is the one thing that
              exposes the newest events being deleted. {v.keyed ? "Keyed (HMAC)." : "Unkeyed: set AUDIT_CHAIN_KEY so a database writer can't recompute the chain."}
            </div>
          )}
        </div>
      ) : (
        <div className="notice" role="alert" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "var(--danger-bg)" }}>
          <strong>Chain broken at event {v.brokenAt}.</strong> {v.reason} The log may have been altered. Events from that point on
          cannot be trusted; investigate before relying on this trail.
        </div>
      )}

      <div className="card">
        <div className="row">
          <div>
            <strong>Data retention</strong>
            <div className="kpi">
              Tenant policy: delete sessions older than {inst?.retentionDays ?? 0} days. Anything under legal hold is never purged.
            </div>
          </div>
          {canRetain ? (
            <form action="/admin/retention" method="post">
              <button className="btn small">Run retention now</button>
            </form>
          ) : (
            <span className="chip">Read-only access</span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Export</strong>
            <div className="kpi">
              Includes each event&apos;s hash and the verification result, so the chain can be re-checked outside this app. Exporting is itself logged.
            </div>
          </div>
          <div className="actions">
            <a className="btn small" href="/audit/export?format=csv">.csv</a>
            <a className="btn small" href="/audit/export?format=json">.json</a>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th title="First characters of this event's hash">Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No events yet.
                  </td>
                </tr>
              ) : (
                [...events].reverse().map((e, i) => {
                  const pos = events.length - i;
                  const isBroken = !v.ok && v.brokenAt === pos;
                  return (
                    <tr key={pos} style={isBroken ? { background: "var(--danger-bg)" } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>{e.ts.slice(0, 19).replace("T", " ")}</td>
                      <td style={{ overflowWrap: "anywhere" }}>{e.actor}</td>
                      <td>{e.action}</td>
                      <td style={{ overflowWrap: "anywhere", minWidth: 160 }}>{e.target}</td>
                      <td>
                        <code className="muted">{e.hash ? e.hash.slice(0, 8) : "—"}</code>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
