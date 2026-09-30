"use client";
import { useState } from "react";
import type { Quiz } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

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
          <strong><span className="qnum">{i + 1}</span>{q.question}</strong>
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
            <div className="cite" style={{ marginTop: 10 }}>
              Why: {q.explanation.text}
              <div style={{ marginTop: 6 }}>
                <GroundingBadge confidence={q.explanation.confidence} flagged={q.explanation.flagged} />
                <SrcChips refs={q.explanation.sourceRefs} />
              </div>
            </div>
          )}
        </div>
      ))}
      {checked && <div className="score">Score: {score} / {quiz.questions.length} 🎯</div>}
      <button className="btn" onClick={() => setChecked(true)}>
        Check answers ✓
      </button>
    </div>
  );
}
