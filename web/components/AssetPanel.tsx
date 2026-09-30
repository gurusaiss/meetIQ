import type { ReactNode } from "react";
import type { StoredAsset } from "../../src/persistence/repository.ts";
import type { RevisionNotes, Flashcard, Quiz } from "../../src/types.ts";
import { StatusBadge } from "./Badge.tsx";
import { NotesView } from "./NotesView.tsx";
import { FlashcardsReview } from "./FlashcardsView.tsx";
import { FlashcardsStudy } from "./FlashcardsStudy.tsx";
import { QuizReview } from "./QuizView.tsx";
import { QuizStudy } from "./QuizStudy.tsx";

const META = {
  notes: { icon: "📝", title: "Revision notes" },
  flashcards: { icon: "🃏", title: "Flashcards" },
  quiz: { icon: "❓", title: "Quiz" },
} as const;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * One knowledge-asset block. `mode="review"` shows static content plus the
 * faculty approve form (nothing reaches students until approved);
 * `mode="student"` shows the interactive study surfaces for approved assets.
 */
export function AssetPanel({
  asset,
  mode,
  headerExtra,
}: {
  asset: StoredAsset;
  mode: "review" | "student";
  /** Extra content for the header row (e.g. the student page's export link). */
  headerExtra?: ReactNode;
}) {
  let inner: ReactNode;
  if (asset.type === "notes") {
    inner = <NotesView notes={asset.content as RevisionNotes} />;
  } else if (asset.type === "flashcards") {
    const cards = (asset.content as { cards: Flashcard[] }).cards;
    inner = mode === "review" ? <FlashcardsReview cards={cards} /> : <FlashcardsStudy cards={cards} />;
  } else {
    const quiz = asset.content as Quiz;
    inner = mode === "review" ? <QuizReview quiz={quiz} /> : <QuizStudy quiz={quiz} />;
  }

  return (
    <section>
      <div className="asset-head">
        <h2>
          <span className="asset-icon">{META[asset.type].icon}</span>
          {META[asset.type].title} <StatusBadge status={asset.status} />
        </h2>
        {mode === "review" &&
          (asset.status !== "approved" ? (
            <form action={`/assets/${encodeURIComponent(asset.id)}/approve`} method="post" style={{ display: "inline" }}>
              <button className="btn small">✓ Approve &amp; release to students</button>
            </form>
          ) : (
            <span className="badge b-approved">released to students</span>
          ))}
        {mode === "student" && headerExtra}
      </div>
      <div className="verify" title="Share of statements whose cited audio was clear">
        <b>{pct(1 - asset.flagRatio)} verified</b>
        <div className="meter" role="img" aria-label={`${pct(1 - asset.flagRatio)} verified`}>
          <i style={{ width: pct(1 - asset.flagRatio) }} />
        </div>
        <span className="kpi">
          {pct(asset.flagRatio)} flagged · {pct(asset.ungroundedRatio)} ungrounded (dropped before saving)
        </span>
      </div>
      {asset.status === "auto_held" && (
        <div className="notice">
          Auto-held for review: {pct(asset.flagRatio)} of statements are low-confidence (far-field
          audio). Verify flagged items before releasing.
        </div>
      )}
      {inner}
    </section>
  );
}
