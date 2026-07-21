import type { RevisionNotes } from "../../src/types.ts";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NotesView({ notes }: { notes: RevisionNotes }) {
  return (
    <>
      {notes.topics.map((topic, i) => (
        <div className="card" key={i}>
          <div className="row">
            <strong>{topic.title}</strong>
            <span className="cite">@{mmss(topic.start)}</span>
          </div>
          {topic.points.map((p, j) => (
            <div className={`point${p.flagged ? " flagged" : ""}`} key={j}>
              {p.text} <span className="cite">[{p.sourceRefs.join(", ")}]</span>
              {p.flagged && (
                <span className="flag-tag"> ⚠ low-confidence audio ({Math.round(p.confidence * 100)}%) — verify</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
