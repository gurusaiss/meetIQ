import type { Flashcard } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

/** Faculty review: both sides shown stacked, no interactivity needed. */
export function FlashcardsReview({ cards }: { cards: Flashcard[] }) {
  return (
    <div className="grid">
      {cards.map((c, i) => (
        <div className="card" key={i}>
          <div className="eyebrow">Question</div>
          <div style={{ fontWeight: 700, margin: "4px 0" }}>{c.front}</div>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "10px 0" }} />
          <div className="eyebrow">Answer</div>
          <div>{c.back.text}</div>
          <div style={{ marginTop: 8 }}>
            <GroundingBadge confidence={c.back.confidence} flagged={c.back.flagged} />
            <SrcChips refs={c.back.sourceRefs} />
          </div>
        </div>
      ))}
    </div>
  );
}
