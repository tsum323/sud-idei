import { STAGE_LABEL, type CourtPlan, type CourtStage } from "@/shared/courtPlan";

const ORDER: CourtStage[] = ["submission", "analysis", "cross", "deliberation", "verdict"];
const SHORT: Record<CourtStage, string> = {
  submission: "Подача",
  evidence: "Доказательства",
  analysis: "Анализ",
  cross: "Критика",
  deliberation: "Совещание",
  verdict: "Вердикт",
};

/** Индикатор стадии заседания. */
export function CourtProgress({ plan }: { plan: CourtPlan | null }) {
  const stage = plan?.stage === "evidence" ? "analysis" : (plan?.stage ?? "submission");
  const current = ORDER.indexOf(stage);
  return (
    <ol className="progress" aria-label={`Стадия: ${STAGE_LABEL[plan?.stage ?? "submission"]}`}>
      {ORDER.map((s, i) => (
        <li key={s} className={i < current ? "is-done" : i === current ? "is-current" : ""} aria-current={i === current ? "step" : undefined}>
          <span className="progress-dot" aria-hidden>
            {i < current ? "✓" : i + 1}
          </span>
          <span className="progress-label">{SHORT[s]}</span>
        </li>
      ))}
    </ol>
  );
}
