import { redirect, notFound } from "next/navigation";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getRepo, getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import { slidesFromNotes } from "../../../../lib/slides.ts";
import type { RevisionNotes } from "../../../../../src/types.ts";

export default async function SlidesPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id: lectureId } = await params;
  const lecture = await getRepo().getLecture(INSTITUTION_ID, lectureId);
  if (!lecture) notFound();

  const approved = await getService().studentAssets(INSTITUTION_ID, lectureId);
  const notes = approved.find((a) => a.type === "notes")?.content as RevisionNotes | undefined;
  const slides = notes ? slidesFromNotes(notes) : [];
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);

  return (
    <>
      <span className="eyebrow">PPT slides</span>
      <h1>{lectureId}</h1>
      <p className="sub">
        One slide per topic, built from approved notes. Sources and confidence go into the speaker
        notes. Low-confidence points are marked ⚠ in the deck.
      </p>

      {slides.length === 0 ? (
        <div className="empty">
          <div className="big">🔒</div>
          <strong>No slides yet</strong>
          <div>
            The notes for this input haven&apos;t been approved.{" "}
            {canManage && <a href={`/lectures/${encodeURIComponent(lectureId)}/review#notes`}>Review and approve them →</a>}
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ margin: "8px 0 16px" }}>
            <span className="kpi">{slides.length + 1} slides (including the title slide)</span>
            <a className="btn" href={`/lectures/${encodeURIComponent(lectureId)}/export/slides.pptx`}>
              ⬇ Download .pptx
            </a>
          </div>
          <div className="slides">
            {slides.map((s, i) => (
              <div className="slide" key={i}>
                <div className="slide-n">{i + 1}</div>
                <div className="slide-title">{s.title}</div>
                <ul>
                  {s.bullets.slice(0, 3).map((b, j) => (
                    <li key={j} className={b.flagged ? "flag" : ""}>
                      {b.flagged ? "⚠ " : ""}
                      {b.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <a className="btn small ghost" href="/pick?feature=slides">← Choose another input</a>{" "}
        <a className="btn small ghost" href="/">Home</a>
      </p>
    </>
  );
}
