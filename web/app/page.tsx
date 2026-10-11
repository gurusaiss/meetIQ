import { redirect } from "next/navigation";
import { getIdentity } from "../lib/auth.ts";
import { getRepo, getAccounts } from "../lib/singletons.ts";
import { tilesFor, noun, toolHref } from "../lib/features.ts";
import { getSectorRole, getSector } from "../../src/auth/sectors.ts";
import { formatJoinCode } from "../../src/auth/accounts.ts";
import { Tile } from "../components/Tile.tsx";
import { CopyCode } from "../components/CopyCode.tsx";
import { DeleteLectureForm } from "../components/DeleteLectureForm.tsx";
import { ProcessForm } from "../components/ProcessButton.tsx";
import { LectureStatusBadge } from "../components/Badge.tsx";

const ADMIN_HREF: Record<string, string> = { approvals: "/approvals", audit: "/audit", team: "/team" };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { welcome } = await searchParams;

  const lectures = await getRepo().listLecturesByCourse(identity.institutionId, identity.courseId!);
  const { inputs, tools, admin, access } = tilesFor(identity);
  const canManage = access.canManage;
  const processed = lectures.filter((l) => l.status === "processed").length;
  const waiting = lectures.filter((l) => l.status === "created").length;
  const visible = canManage ? lectures : lectures.filter((l) => l.status === "processed");
  const one = noun(identity);
  const many = noun(identity, true);
  const title = getSectorRole(identity.sector, identity.profile)?.name ?? identity.role;
  const sector = getSector(identity.sector);
  const inviteCode = await getAccounts().inviteCodeFor(identity);

  return (
    <>
      {welcome && (
        <div className="notice ok" role="status">
          Welcome, {identity.name.split(" ")[0]}! Your {title.toLowerCase()} account is ready.
          {inviteCode ? " Share the invite code below with your team." : ""}
        </div>
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
        <div className="stat"><b>{lectures.length}</b><span>{many[0].toUpperCase() + many.slice(1)}</span></div>
        <div className="stat"><b>{processed}</b><span>Processed &amp; verified</span></div>
        <div className="stat"><b>{waiting}</b><span>Waiting to process</span></div>
      </div>

      {inviteCode && (
        <div className="card">
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
                <LectureStatusBadge status={l.status} /> <span className="chip">{l.captureSource}</span> · created{" "}
                {l.createdAt.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div className="actions">
              {l.status === "created" ? (
                <>
                  {canManage && <ProcessForm id={l.id} />}
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              ) : l.status === "failed" || l.status === "processing" ? (
                // Reprocessing in place isn't allowed (see the comment on
                // LectureService.processLecture): a lecture stuck here can only be
                // recovered by delete + recreate, so don't link into one with no valid content.
                <>
                  <span className="kpi">
                    {l.status === "failed"
                      ? "Processing failed."
                      : "Still processing. If this persists, the run likely crashed."}{" "}
                    {canManage ? "Delete and create it again to retry." : "Ask your administrator to retry."}
                  </span>
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
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
                  {canManage && <DeleteLectureForm id={l.id} />}
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {canManage && identity.sector === "uni" && !identity.owner && identity.id.startsWith("demo-") && (
        <div className="card">
          <div className="row">
            <div>
              <strong>Import from capture system</strong>
              <div className="kpi">Pull existing recordings from Echo360/Panopto. Demo uses a mock source.</div>
            </div>
            <form action="/import" method="post">
              <button className="btn small ghost">Import from Echo360 (demo)</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
