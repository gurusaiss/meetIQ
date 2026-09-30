import { redirect, notFound, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getRepo, getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import { AssetPanel } from "../../../../components/AssetPanel.tsx";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string; total?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["faculty", "ta", "admin"])) forbidden();

  const { id: lectureId } = await params;
  const { published, total } = await searchParams;
  const lecture = await getRepo().getLecture(INSTITUTION_ID, lectureId);
  if (!lecture) notFound();

  const assets = await getService().reviewQueue(INSTITUTION_ID, lectureId);
  const approvedCount = assets.filter((a) => a.status === "approved").length;

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
            ? `Published ${published} approved asset(s) to the LMS (mock connector). Total pushed this session: ${total}.`
            : "Nothing to publish — approve at least one asset first."}
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
            <strong>Publish to LMS</strong>
            <div className="kpi">
              Pushes {approvedCount} approved asset(s) into Canvas/Moodle. Demo uses a
              mock connector.
            </div>
          </div>
          <form action={`/lectures/${encodeURIComponent(lectureId)}/publish`} method="post">
            <button className="btn small" disabled={approvedCount === 0}>
              Publish approved
            </button>
          </form>
        </div>
      </div>

      {assets.map((a) => (
        <div key={a.id}>
          <AssetPanel asset={a} mode="review" />
        </div>
      ))}

      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href="/">← Dashboard</a>
      </p>
    </>
  );
}
