import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, COURSE_ID } from "../../lib/singletons.ts";
import { TOOL_TILES, INPUT_TILES, toolHref } from "../../lib/features.ts";
import { Tile } from "../../components/Tile.tsx";
import { ProcessForm } from "../../components/ProcessButton.tsx";
import { LectureStatusBadge } from "../../components/Badge.tsx";

export default async function PickPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { feature } = await searchParams;
  const tool = TOOL_TILES.find((t) => t.key === feature);
  if (!tool) redirect("/");
  if (tool.key === "search") redirect("/search");

  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);
  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, COURSE_ID);
  const usable = canManage ? lectures : lectures.filter((l) => l.status === "processed");

  return (
    <>
      <span className="eyebrow">Step 1 of 2</span>
      <h1>
        {tool.icon} {tool.title}: choose an input
      </h1>
      <p className="sub">Pick the recording, text or transcript you want to use.</p>

      {usable.length === 0 ? (
        <div className="empty">
          <div className="big">📭</div>
          <strong>No inputs yet</strong>
          <div style={{ marginBottom: 16 }}>
            {canManage ? "Add one first, then come back here." : "Ask your instructor to add a session."}
          </div>
          {canManage && (
            <div className="tiles" style={{ textAlign: "left" }}>
              {INPUT_TILES.map((t) => (
                <Tile key={t.key} tile={t} href={`/new?mode=${t.key}`} />
              ))}
            </div>
          )}
        </div>
      ) : (
        usable.map((l) => (
          <div className="card session" key={l.id}>
            <div>
              <div className="session-id">{l.id}</div>
              <div className="kpi" style={{ marginTop: 4 }}>
                <LectureStatusBadge status={l.status} /> <span className="chip">{l.captureSource}</span>
              </div>
            </div>
            <div className="actions">
              {l.status === "processed" ? (
                <a className="btn small" href={toolHref(tool.key, l.id, canManage)}>
                  Use this input →
                </a>
              ) : l.status === "created" && canManage ? (
                <>
                  <span className="kpi">Process it first</span>
                  <ProcessForm id={l.id} />
                </>
              ) : (
                <span className="kpi">{l.status === "failed" ? "Processing failed" : "Not ready"}</span>
              )}
            </div>
          </div>
        ))
      )}
      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href="/">← Back</a>
      </p>
    </>
  );
}
