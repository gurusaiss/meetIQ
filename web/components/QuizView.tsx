import type { Quiz } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

/** Faculty review: static, correct answer marked, no interactivity needed. */
export function QuizReview({ quiz }: { quiz: Quiz }) {
  return (
    <>
      {quiz.questions.map((q, i) => (
        <div className="card" key={i}>
          <strong><span className="qnum">{i + 1}</span>{q.question}</strong>
          {q.options.map((o, j) => (
            <div className="point" key={j}>
              {j === q.answerIndex ? "✅ " : "○ "}
              {o}
            </div>
          ))}
          <div className="cite" style={{ marginTop: 10 }}>
            Why: {q.explanation.text}
            <div style={{ marginTop: 6 }}>
              <GroundingBadge confidence={q.explanation.confidence} flagged={q.explanation.flagged} />
              <SrcChips refs={q.explanation.sourceRefs} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
