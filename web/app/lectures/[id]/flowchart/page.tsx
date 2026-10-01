import { Fragment } from "react";
import { redirect, notFound } from "next/navigation";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getRepo, getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import type { RevisionNotes } from "../../../../../src/types.ts";

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export default async function FlowchartPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id: lectureId } = await params;
  const lecture = await getRepo().getLecture(INSTITUTION_ID, lectureId);
  if (!lecture) notFound();

  const approved = await getService().studentAssets(INSTITUTION_ID, lectureId);
  const notes = approved.find((a) => a.type === "notes")?.content as RevisionNotes | undefined;
  const topics = (notes?.topics ?? []).filter((t) => t.points.length > 0);
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);

  return (
    <>
      <span className="eyebrow">Flowchart</span>
      <h1>{lectureId}</h1>
      <p className="sub">
        The session as a step-by-step flow. Built only from approved, verified notes: no new AI
        content is added.
      </p>

      {topics.length === 0 ? (
        <div className="empty">
          <div className="big">🔒</div>
          <strong>Nothing to draw yet</strong>
          <div>
            The notes for this input haven&apos;t been approved.{" "}
            {canManage && <a href={`/lectures/${encodeURIComponent(lectureId)}/review#notes`}>Review and approve them →</a>}
          </div>
        </div>
      ) : (
        <div className="flow">
          <div className="flow-end">▶ Start</div>
          {topics.map((t, i) => {
            const anyFlag = t.points.some((p) => p.flagged);
            return (
              <Fragment key={i}>
                <div className="flow-arrow" aria-hidden="true">↓</div>
                <div className={`flow-node${anyFlag ? " flagged" : ""}`}>
                  <div className="flow-head">
                    <span className="qnum">{i + 1}</span>
                    <strong>{t.title}</strong>
                    <span className="ts">▶ {mmss(t.start)}</span>
                  </div>
                  <ul>
                    {t.points.slice(0, 3).map((p, j) => (
                      <li key={j} className={p.flagged ? "flag" : ""}>
                        {p.flagged ? "⚠ " : ""}
                        {p.text}
                      </li>
                    ))}
                  </ul>
                  {t.points.length > 3 && <div className="kpi">+ {t.points.length - 3} more in the notes</div>}
                </div>
              </Fragment>
            );
          })}
          <div className="flow-arrow" aria-hidden="true">↓</div>
          <div className="flow-end">✓ Done</div>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href="/pick?feature=flowchart">← Choose another input</a>{" "}
        <a className="btn small ghost" href="/">Home</a>
      </p>
    </>
  );
}
