"use client";
import { useState } from "react";
import type { Flashcard } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";

/** Student view: click-to-flip, driven by real React state (no inline script). */
export function FlashcardsStudy({ cards }: { cards: Flashcard[] }) {
  return (
    <div className="grid">
      {cards.map((c, i) => (
        <FlipCard key={i} card={c} />
      ))}
    </div>
  );
}

function FlipCard({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className="card fc"
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
    >
      <div className="muted" style={{ fontSize: 13 }}>Flashcard — click to flip</div>
      {!flipped ? (
        <div style={{ marginTop: 8 }}>{card.front}</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {card.back.text}
          <div className="cite" style={{ marginTop: 6 }}>
            [{card.back.sourceRefs.join(", ")}]
            <GroundingBadge confidence={card.back.confidence} flagged={card.back.flagged} />
          </div>
        </div>
      )}
    </div>
  );
}
