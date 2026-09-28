"use client";
import { useState } from "react";
import type { Quiz } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";

/** Student view: self-grading quiz runner, driven by real React state. */
export function QuizStudy({ quiz }: { quiz: Quiz }) {
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);

  const score = quiz.questions.reduce(
    (acc, q, i) => acc + (selected[i] === q.answerIndex ? 1 : 0),
    0,
  );

  return (
    <div>
      {quiz.questions.map((q, i) => (
        <div className="card" key={i}>
          <strong>Q{i + 1}. {q.question}</strong>
          {q.options.map((o, j) => {
            let cls = "opt";
            if (checked) {
              if (j === q.answerIndex) cls += " correct";
              else if (selected[i] === j) cls += " wrong";
            }
            return (
              <label className={cls} key={j}>
                <input
                  type="radio"
                  name={`q${i}`}
                  value={j}
                  style={{ width: "auto", marginRight: 8 }}
                  checked={selected[i] === j}
                  onChange={() => setSelected((s) => ({ ...s, [i]: j }))}
                />
                {o}
              </label>
            );
          })}
          {checked && (
            <div className="cite" style={{ marginTop: 8 }}>
              Why: {q.explanation.text} [{q.explanation.sourceRefs.join(", ")}]
              <GroundingBadge confidence={q.explanation.confidence} flagged={q.explanation.flagged} />
            </div>
          )}
        </div>
      ))}
      {checked && <div className="score">Score: {score} / {quiz.questions.length}</div>}
      <button className="btn" onClick={() => setChecked(true)}>
        Check answers
      </button>
    </div>
  );
}
