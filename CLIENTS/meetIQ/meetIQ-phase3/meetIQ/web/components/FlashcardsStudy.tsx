"use client";
import { useState } from "react";
import type { Flashcard } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

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
      className={`card fc${flipped ? " flipped" : ""}`}
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
      <div className="eyebrow">{flipped ? "Answer" : "Question"} · click to flip</div>
      {!flipped ? (
        <div className="q">{card.front}</div>
      ) : (
        <div className="q">
          {card.back.text}
          <div style={{ marginTop: 10 }}>
            <GroundingBadge confidence={card.back.confidence} flagged={card.back.flagged} />
            <SrcChips refs={card.back.sourceRefs} />
          </div>
        </div>
      )}
    </div>
  );
}
