import { redirect } from "next/navigation";
import { getIdentity } from "../lib/auth.ts";
import { getRepo, getAccounts, getCapture, getService } from "../lib/singletons.ts";
import { tilesFor, noun, toolHref } from "../lib/features.ts";
import { getSectorRole, getSector } from "../../src/auth/sectors.ts";
import { formatJoinCode } from "../../src/auth/accounts.ts";
import { Tile, Icon } from "../components/Tile.tsx";
import { CopyCode } from "../components/CopyCode.tsx";
import { DeleteLectureForm } from "../components/DeleteLectureForm.tsx";
import { ProcessForm } from "../components/ProcessButton.tsx";
import { LectureStatusBadge } from "../components/Badge.tsx";
import { AutoRefresh } from "../components/AutoRefresh.tsx";

export const metadata = { title: "Workspace · MeetIQ" };

const ADMIN_HREF: Record<string, string> = { approvals: "/approvals", audit: "/audit", team: "/team" };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; queued?: string; verified?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { welcome, queued, verified } = await searchParams;

  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, identity.courseId!);
  const { inputs, tools, admin, access } = tilesFor(identity);
  const canManage = access.canManage;
  const processed = lectures.filter((l) => l.status === "processed").length;
  const waiting = lectures.filter((l) => l.status === "created").length;
  const processing = lectures.filter((l) => l.status === "processing").length;
  const visible = canManage ? lectures : lectures.filter((l) => l.status === "processed");
  const one = noun(identity);
  const many = noun(identity, true);
  const title = getSectorRole(identity.sector, identity.profile)?.name ?? identity.role;
  const sector = getSector(identity.sector);
  const inviteCode = await getAccounts().inviteCodeFor(identity);
  const trackedActions = await getService().listActionItems(identity.institutionId, identity.courseId!, identity);
  const openActions = trackedActions.filter((t) => !t.done).length;

  return (
    <>
      {processing > 0 && <AutoRefresh intervalMs={4000} />}
      {welcome && (
        <div className="notice ok" role="status">
          Welcome, {identity.name.split(" ")[0]}! Your {title.toLowerCase()} account is ready.
          {inviteCode ? " Share the invite code below with your team." : ""}
        </div>
      )}
      {queued && (
        <div className="notice ok" role="status">
          Processing started for {queued} — it&apos;s running in the background, this page refreshes automatically.
        </div>
      )}
      {verified && (
        <div className="notice ok" role="status">Email verified. Thanks!</div>
      )}
      <span className="eyebrow">
        {identity.orgName} · {title}
      </span>
      <h1>Hi {identity.name.split(" ")[0]}</h1>
      <p className="sub">
        {canManage
          ? `Bring in a ${one} recording or text, then pick what to make from it. Every line is cited and verified.`
          : `Study the verified material your team has approved, or search across every ${one}.`}
      </p>

      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="notes" /></span><b>{lectures.length}</b><span>{many[0].toUpperCase() + many.slice(1)}</span></div>
        <div className="stat"><span className="stat-icon"><Icon name="approvals" /></span><b>{processed}</b><span>Processed &amp; verified</span></div>
        <div className="stat"><span className="stat-icon"><Icon name="record" /></span><b>{waiting}</b><span>Waiting to process</span></div>
      </div>

      {openActions > 0 && (
        <div className="card">
          <div className="row">
            <div>
              <strong>{openActions} open action item{openActions === 1 ? "" : "s"}</strong>
              <div className="kpi">From your approved {many}. Assign them and tick them off in the tracker.</div>
            </div>
            <a className="btn small" href="/actions">Open the tracker</a>
          </div>
        </div>
      )}

      {inviteCode && (
        <div className="card highlight">
          <div className="row">
            <div>
              <strong>Invite your team</strong>
              <div className="kpi">Colleagues choose their field, pick &ldquo;Join&rdquo; and enter this code.</div>
            </div>
            <CopyCode code={formatJoinCode(inviteCode)} />
          </div>
        </div>
      )}

      {inputs.length > 0 && (
        <>
          <div className="section-title">1 · Add an input</div>
          <div className="tiles">
            {inputs.map((t) => (
              <Tile key={t.key} tile={t} href={`/new?mode=${t.key}`} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">{canManage ? "2 · Make something from it" : "What do you want to do?"}</div>
      <div className="tiles">
        {tools.map((t) => (
          <Tile key={t.key} tile={t} href={t.key === "search" ? "/search" : `/pick?feature=${t.key}`} />
        ))}
      </div>

      {admin.length > 0 && (
        <>
          <div className="section-title">Oversight</div>
          <div className="tiles">
            {admin.map((t) => (
              <Tile key={t.key} tile={t} href={ADMIN_HREF[t.key] ?? "/"} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">Your {many}</div>
      {visible.length === 0 && (
        <div className="empty">
          <span className="empty-icon"><Icon name="upload" /></span>
          <strong>Nothing here yet</strong>
          <div>{canManage ? "Record, upload or paste something above to get started." : "Nothing has been approved and shared yet."}</div>
        </div>
      )}

      {visible.map((l) => (
        <div className="card" key={l.id}>
          <div className="session">
            <div>
              <div className="session-id">{l.id}</div>
              <div className="kpi" style={{ marginTop: 4 }}>
                <LectureStatusBadge status={l.status} />{" "}
                {l.hold && <span className="badge b-held" title={l.hold.reason}>legal hold</span>}{" "}
                <span className="chip">{l.captureSource}</span> · created{" "}
                {l.createdAt.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div className="actions">
              {l.status === "created" ? (
                <>
                  {canManage && <ProcessForm id={l.id} />}
                  {canManage && !l.hold && <DeleteLectureForm id={l.id} />}
                </>
              ) : l.status === "failed" ? (
                // Reprocessing in place isn't allowed (see the comment on
                // LectureService.processLecture): a failed lecture can only
                // be recovered by delete + recreate.
                <>
                  <span className="kpi">
                    Processing failed. {canManage ? "Delete and create it again to retry." : "Ask your administrator to retry."}
                  </span>
                  {canManage && !l.hold && <DeleteLectureForm id={l.id} />}
                </>
              ) : l.status === "processing" ? (
                // Running on the background job queue (see
                // LectureService.enqueueProcessLecture) — a normal,
                // transient state, not a crash. This page polls itself
                // (AutoRefresh above) until it flips to processed/failed.
                <span className="kpi">Processing in the background — this page refreshes automatically.</span>
              ) : (
                <>
                  {canManage && (
                    <a className="btn small" href={`/lectures/${encodeURIComponent(l.id)}/review`}>
                      Review
                    </a>
                  )}
                  <a className="btn small ghost" href={toolHref("notes", l.id, false)}>
                    {canManage ? "Student view" : "Open"}
                  </a>
                  {canManage && !l.hold && <DeleteLectureForm id={l.id} />}
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {canManage && identity.id.startsWith("demo-") && (() => {
        const capture = getCapture();
        const live = capture.name !== "mock";
        return (
          <div className="card">
            <div className="row">
              <div>
                <strong>Import from {live ? capture.name : "capture system"}</strong>
                <div className="kpi">
                  {live
                    ? `Pulls real recordings in via the live "${capture.name}" connector.`
                    : "Pull existing recordings from Echo360/Panopto/Zoom. Demo uses a mock source — set CAPTURE_SOURCE to pull real ones."}
                </div>
              </div>
              <form action="/import" method="post">
                <button className="btn small ghost">{live ? `Import from ${capture.name}` : "Import from Echo360 (demo)"}</button>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}
