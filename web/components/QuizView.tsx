import type { Quiz } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";

/** Faculty review: static, correct answer marked, no interactivity needed. */
export function QuizReview({ quiz }: { quiz: Quiz }) {
  return (
    <>
      {quiz.questions.map((q, i) => (
        <div className="card" key={i}>
          <strong>Q{i + 1}. {q.question}</strong>
          {q.options.map((o, j) => (
            <div className="point" key={j}>
              {j === q.answerIndex ? "✅ " : "○ "}
              {o}
            </div>
          ))}
          <div className="cite" style={{ marginTop: 8 }}>
            Why: {q.explanation.text} [{q.explanation.sourceRefs.join(", ")}]
            <GroundingBadge confidence={q.explanation.confidence} flagged={q.explanation.flagged} />
          </div>
        </div>
      ))}
    </>
  );
}
