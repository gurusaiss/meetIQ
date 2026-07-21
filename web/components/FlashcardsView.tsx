import type { Flashcard } from "../../src/types.ts";

/** Faculty review: both sides shown stacked, no interactivity needed. */
export function FlashcardsReview({ cards }: { cards: Flashcard[] }) {
  return (
    <div className="grid">
      {cards.map((c, i) => (
        <div className="card" key={i}>
          <div className="muted" style={{ fontSize: 13 }}>Q</div>
          <div>{c.front}</div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "10px 0" }} />
          <div className="muted" style={{ fontSize: 13 }}>
            A {c.back.flagged && <span className="flag-tag">⚠</span>}
          </div>
          <div>{c.back.text}</div>
          <div className="cite" style={{ marginTop: 6 }}>[{c.back.sourceRefs.join(", ")}]</div>
        </div>
      ))}
    </div>
  );
}
