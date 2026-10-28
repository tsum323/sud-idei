"use client";

import { useState } from "react";
import { criterionLabel } from "@/shared/criteria";
import type { CriterionVerdict } from "@/shared/schemas";
import { CONFIDENCE_LABEL } from "@/shared/scoring";

function tone(score: number) {
  return score >= 70 ? "good" : score >= 45 ? "mid" : "bad";
}

/** Компактные пиксельные шкалы по 10 критериям; по нажатию — объяснение. */
export function Scorecard({ scores }: { scores: CriterionVerdict[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="scorecard">
      {scores.map((s) => {
        const isOpen = open === s.criterion;
        return (
          <li key={s.criterion} className={`score-row tone-${tone(s.score)}`}>
            <button type="button" className="score-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.criterion)}>
              <span className="score-label">{criterionLabel(s.criterion)}</span>
              <span className="score-bar" aria-hidden>
                <span className="score-fill" style={{ width: `${s.score}%` }} />
              </span>
              <span className="score-num">{s.score}</span>
              <span className={`conf conf-${s.confidence}`} title={`Уверенность: ${CONFIDENCE_LABEL[s.confidence]}`}>
                {CONFIDENCE_LABEL[s.confidence]}
              </span>
            </button>
            {isOpen && (
              <div className="score-detail">
                <p>{s.explanation}</p>
                {s.keyArguments.length > 0 && (
                  <ul>{s.keyArguments.map((k, i) => <li key={i}>{k}</li>)}</ul>
                )}
                {s.missingData.length > 0 && <p className="muted small">Не хватает данных: {s.missingData.join("; ")}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
