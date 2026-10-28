import { CRITERIA, type CriterionKey } from "./criteria";
import type { AgentAnalysis } from "./types";
import type { Confidence, CriterionVerdict, Decision, RiskItem } from "./schemas";

export function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Ориентировочная общая оценка качества идеи: взвешенное среднее по критериям.
 * Это оценка модели, а не статистическая вероятность успеха.
 */
export function computeOverallScore(scores: Pick<CriterionVerdict, "criterion" | "score">[]): number {
  let sum = 0;
  let weights = 0;
  for (const c of CRITERIA) {
    const s = scores.find((x) => x.criterion === c.key);
    if (!s) continue;
    sum += clampScore(s.score) * c.weight;
    weights += c.weight;
  }
  return weights === 0 ? 0 : Math.round(sum / weights);
}

export interface AggregatedCriterion {
  criterion: CriterionKey;
  mean: number | null;
  min: number | null;
  max: number | null;
  votes: number;
  /** Разброс оценок агентов: большой разброс = разногласие. */
  spread: number;
}

/** Сводка оценок агентов по критериям (только завершённые анализы). */
export function aggregateAgentScores(analyses: AgentAnalysis[]): AggregatedCriterion[] {
  const done = analyses.filter((a) => a.status === "done");
  return CRITERIA.map((c) => {
    const values = done
      .flatMap((a) => a.scorecard ?? [])
      .filter((s) => s.criterion === c.key)
      .map((s) => clampScore(s.score));
    if (values.length === 0) {
      return { criterion: c.key, mean: null, min: null, max: null, votes: 0, spread: 0 };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    return { criterion: c.key, mean, min, max, votes: values.length, spread: max - min };
  });
}

/** Критерии, по которым агенты сильно расходятся. */
export function findScoreConflicts(analyses: AgentAnalysis[], threshold = 35): AggregatedCriterion[] {
  return aggregateAgentScores(analyses).filter((c) => c.votes >= 2 && c.spread >= threshold);
}

export interface DecisionContext {
  overallScore: number;
  criteria: Pick<CriterionVerdict, "criterion" | "score">[];
  unresolvedCriticalRisks: number;
}

/**
 * Ориентир для решения — справочная подсказка судье. Низкая оценка по одному
 * критерию сама по себе к отклонению не приводит: решающими считаются общий
 * уровень и нерешённые критические риски.
 */
export function suggestDecision(ctx: DecisionContext): Decision {
  const { overallScore, unresolvedCriticalRisks } = ctx;
  const problem = ctx.criteria.find((c) => c.criterion === "problem_reality")?.score ?? 50;
  const demand = ctx.criteria.find((c) => c.criterion === "demand_potential")?.score ?? 50;

  // Нет ни проблемы, ни спроса — это фундаментальный провал, а не единичный слабый критерий.
  const fundamentalFailure = problem < 25 && demand < 25;

  if (overallScore < 38 || fundamentalFailure || (unresolvedCriticalRisks >= 2 && overallScore < 50)) {
    return "rejected";
  }
  if (overallScore >= 72 && unresolvedCriticalRisks === 0) return "approved";
  if (overallScore >= 56) return "conditional";
  return "rework";
}

export function countCriticalRisks(risks: RiskItem[]): number {
  return risks.filter((r) => r.severity === "critical").length;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

export const DECISION_LABEL: Record<Decision, string> = {
  approved: "Допущена к реализации",
  conditional: "Условный допуск",
  rework: "Отправлена на доработку",
  rejected: "Отклонена — в Тюрьму идей",
};

export const SEVERITY_LABEL: Record<RiskItem["severity"], string> = {
  low: "низкий",
  medium: "средний",
  high: "высокий",
  critical: "критический",
};
