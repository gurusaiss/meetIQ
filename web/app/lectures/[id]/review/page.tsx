import { redirect, notFound, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getRepo, getService, getLms } from "../../../../lib/singletons.ts";
import { AssetPanel } from "../../../../components/AssetPanel.tsx";

export const metadata = { title: "Review · MeetIQ" };

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string; total?: string; hold?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["faculty", "ta", "admin"])) forbidden();

  const { id: lectureId } = await params;
  const { published, total, hold } = await searchParams;
  const lecture = await getRepo().getLecture(identity.institutionId, lectureId);
  if (!lecture) notFound();

  const assets = await getService().reviewQueue(identity.institutionId, lectureId);
  const approvedCount = assets.filter((a) => a.status === "approved").length;
  const lms = getLms();
  const holdBy = lecture.hold
    ? ((await getRepo().listUsers(identity.institutionId)).find((u) => u.id === lecture.hold!.by)?.name ?? lecture.hold.by)
    : "";
  const liveLms = lms.name !== "mock";

  return (
    <>
      <span className="eyebrow">Faculty review</span>
      <h1>{lectureId}</h1>
      <p className="sub">
        Nothing reaches students until you approve it. Low-confidence spans from far-field audio
        are highlighted.
      </p>

      {published !== undefined && (
        <div className="notice">
          {Number(published) > 0
            ? `Published ${published} approved asset(s) via the "${lms.name}" connector${liveLms ? "" : " (demo — nothing leaves this app yet)"}. Total pushed this session: ${total}.`
            : "Nothing to publish — approve at least one asset first."}
        </div>
      )}

      {hold && (
        <div className="notice ok" role="status">
          {hold === "placed"
            ? "Legal hold placed. This session can't be deleted or purged until an administrator releases it."
            : "Legal hold released."}
        </div>
      )}

      <div className="legend">
        <span>How to read this:</span>
        <span className="badge gbadge b-approved">✓ Verified · 92%</span> cited and clear audio
        <span className="badge gbadge b-held">⚠ Low-confidence · 61%</span> cited, but audio was unclear
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Publish{liveLms ? ` via ${lms.name}` : " to LMS"}</strong>
            <div className="kpi">
              {liveLms
                ? `Pushes ${approvedCount} approved asset(s) out through the live "${lms.name}" connector — this leaves the app for real.`
                : `Pushes ${approvedCount} approved asset(s) to a demo LMS connector. Nothing leaves this app yet; set LMS_CONNECTOR (and its credentials) to push for real — see .env.example.`}
            </div>
          </div>
          <form action={`/lectures/${encodeURIComponent(lectureId)}/publish`} method="post">
            <button className="btn small" disabled={approvedCount === 0}>
              Publish approved
            </button>
          </form>
        </div>
      </div>

      <div className={`card${lecture.hold ? " highlight" : ""}`}>
        {lecture.hold ? (
          <div className="row">
            <div>
              <strong>Under legal hold</strong>
              <div className="kpi">
                &ldquo;{lecture.hold.reason}&rdquo; · placed by {holdBy} on {lecture.hold.at.slice(0, 10)}. It can&apos;t be
                deleted or purged while this stands.
              </div>
            </div>
            {identity.role === "admin" ? (
              <form action={`/lectures/${encodeURIComponent(lectureId)}/hold`} method="post">
                <input type="hidden" name="action" value="release" />
                <button className="btn small ghost">Release hold</button>
              </form>
            ) : (
              <span className="chip">Only an administrator can release it</span>
            )}
          </div>
        ) : (
          <form action={`/lectures/${encodeURIComponent(lectureId)}/hold`} method="post">
            <input type="hidden" name="action" value="place" />
            <div className="row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>Legal hold</strong>
                <div className="kpi">Preserve this recording and everything derived from it: no deletion, no retention purge.</div>
                <label htmlFor="hold-reason" className="sr-only">Reason or matter reference</label>
                <input id="hold-reason" name="reason" required maxLength={300} placeholder="Matter or case reference, e.g. Smith v. Jones, No. 24-1138" style={{ marginTop: 8 }} />
              </div>
              <button className="btn small ghost">Place hold</button>
            </div>
          </form>
        )}
      </div>

      {assets.map((a) => (
        <div key={a.id}>
          <AssetPanel asset={a} mode="review" />
        </div>
      ))}

      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href={`/lectures/${encodeURIComponent(lectureId)}/transcript`}>Transcript &amp; captions</a>{" "}
        <a className="btn small ghost" href="/">← Dashboard</a>
      </p>
    </>
  );
}
