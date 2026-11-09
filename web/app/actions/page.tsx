import { redirect } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getRepo, getService } from "../../lib/singletons.ts";
import { toolHref } from "../../lib/features.ts";
import { GroundingBadge } from "../../components/GroundingBadge.tsx";
import type { TrackedAction } from "../../../src/services/lecture-service.ts";

export const metadata = { title: "Action tracker · MeetIQ" };

function Item({ t, canManage, nameOf }: { t: TrackedAction; canManage: boolean; nameOf: (id: string) => string }) {
  const href = toolHref("actions", t.lectureId, canManage);
  return (
    <div className={`point${t.flagged ? " flagged" : ""}${t.done ? " is-done" : ""}`} id={`item-${t.lectureId}-${t.index}`}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="t-text">{t.text}</span>
        {t.assignee ? <span className="chip">{t.assignee}</span> : <span className="chip" style={{ opacity: 0.6 }}>Unassigned</span>}
      </div>
      <div className="kpi" style={{ marginTop: 6 }}>
        From <a href={href}>{t.lectureId}</a>
        {t.speaker && !t.assignee ? <> · said by {t.speaker}</> : null}
        {t.done && t.updatedBy ? <> · done by {nameOf(t.updatedBy)}{t.updatedAt ? ` on ${t.updatedAt.slice(0, 10)}` : ""}</> : null}
        <GroundingBadge confidence={t.confidence} flagged={t.flagged} />
      </div>
      {canManage && (
        <form action="/actions/update" method="post" className="tracker-assign">
          <input type="hidden" name="lectureId" value={t.lectureId} />
          <input type="hidden" name="index" value={t.index} />
          <label htmlFor={`as-${t.lectureId}-${t.index}`} className="sr-only">Assign to</label>
          <input id={`as-${t.lectureId}-${t.index}`} name="assignee" defaultValue={t.assignee ?? ""} maxLength={80} placeholder="Assign to…" />
          <button className="btn small ghost" name="intent" value="assign">Save</button>
          {t.done ? (
            <button className="btn small ghost" name="intent" value="reopen">Reopen</button>
          ) : (
            <button className="btn small" name="intent" value="done">Mark done</button>
          )}
        </form>
      )}
    </div>
  );
}

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { who } = await searchParams;
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);

  const all = await getService().listActionItems(identity.institutionId, identity.courseId!, identity);
  // Actors are stored by id; show the person's name where we have one.
  const people = new Map((await getRepo().listUsers(identity.institutionId)).map((u) => [u.id, u.name]));
  const nameOf = (id: string) => people.get(id) ?? id;
  const mine = who === "me";
  const me = identity.name.trim().toLowerCase();
  const shown = mine ? all.filter((t) => t.assignee?.toLowerCase() === me) : all;
  const open = shown.filter((t) => !t.done);
  const done = shown.filter((t) => t.done);

  return (
    <>
      <span className="eyebrow">{identity.orgName}</span>
      <h1>Action tracker</h1>
      <p className="sub">
        Every action item from your approved meetings, in one place. Only items that have been reviewed and released appear here.
        {canManage ? " Assign them and tick them off as they get done." : ""}
      </p>

      <div className="stats">
        <div className="stat"><b>{open.length}</b><span>Open</span></div>
        <div className="stat"><b>{done.length}</b><span>Done</span></div>
        <div className="stat"><b>{open.filter((t) => !t.assignee).length}</b><span>Unassigned</span></div>
      </div>

      <div className="actions" style={{ margin: "18px 0 4px" }}>
        <a className={`btn small${mine ? " ghost" : ""}`} href="/actions">Everyone</a>
        <a className={`btn small${mine ? "" : " ghost"}`} href="/actions?who=me">Assigned to me</a>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <strong>No action items yet</strong>
          <div>
            They appear once a meeting&apos;s &ldquo;Decisions &amp; action items&rdquo; have been approved.
            {canManage && <> <a href="/approvals">Review what&apos;s waiting →</a></>}
          </div>
        </div>
      ) : (
        <>
          <div className="section-title">Open · {open.length}</div>
          {open.length === 0 ? (
            <div className="empty"><strong>{mine ? "Nothing assigned to you" : "All caught up"}</strong></div>
          ) : (
            open.map((t) => <Item key={`${t.lectureId}#${t.index}`} t={t} canManage={canManage} nameOf={nameOf} />)
          )}

          {done.length > 0 && (
            <details style={{ marginTop: 24 }}>
              <summary className="section-title" style={{ cursor: "pointer" }}>Done · {done.length}</summary>
              {done.map((t) => <Item key={`${t.lectureId}#${t.index}`} t={t} canManage={canManage} nameOf={nameOf} />)}
            </details>
          )}
        </>
      )}
    </>
  );
}
