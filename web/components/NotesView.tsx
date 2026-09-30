import type { RevisionNotes } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

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
            <strong style={{ fontSize: 16 }}>{topic.title}</strong>
            <span className="ts">▶ {mmss(topic.start)}</span>
          </div>
          {topic.points.map((p, j) => (
            <div className={`point${p.flagged ? " flagged" : ""}`} key={j}>
              {p.text}
              <div style={{ marginTop: 6 }}>
                <GroundingBadge confidence={p.confidence} flagged={p.flagged} />
                <SrcChips refs={p.sourceRefs} />
              </div>
              {p.flagged && (
                <span className="flag-tag">Far-field audio — verify before relying on this</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
