import { CRITERIA } from "./criteria";
import type { AgentOutput, Claim, CriterionVerdict, CrossExamOutput, VerdictOutput } from "./schemas";
import { clampScore, type AggregatedCriterion } from "./scoring";

const cut = (s: unknown, max: number): string => {
  const str = typeof s === "string" ? s.trim() : "";
  return str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;
};
const list = (arr: unknown, maxItems: number, maxLen: number): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x) => cut(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

/** Ограничения длины ответов, применяемые после получения ответа модели. */
export const OUTPUT_LIMITS = {
  summary: 400,
  fullText: 3000,
  item: 300,
  items: 6,
  claims: 8,
};

/**
 * Утверждение может считаться фактом только при ссылке на существующее
 * доказательство. Иначе оно понижается до «предположения».
 */
export function enforceEvidence(claims: Claim[], validRefs: Set<string>): { claims: Claim[]; downgraded: number } {
  let downgraded = 0;
  const out = claims.map((c) => {
    const evidenceIds = (c.evidenceIds ?? []).filter((id) => validRefs.has(id));
    if (c.kind === "fact" && evidenceIds.length === 0) {
      downgraded++;
      return { ...c, kind: "assumption" as const, evidenceIds };
    }
    return { ...c, evidenceIds };
  });
  return { claims: out, downgraded };
}

export function normalizeAgentOutput(raw: AgentOutput, validRefs: Set<string>): AgentOutput & { downgraded: number } {
  const { claims, downgraded } = enforceEvidence(
    (raw.claims ?? []).slice(0, OUTPUT_LIMITS.claims).map((c) => ({
      statement: cut(c.statement, OUTPUT_LIMITS.item),
      kind: c.kind,
      evidenceIds: Array.isArray(c.evidenceIds) ? c.evidenceIds.slice(0, 5) : [],
    })),
    validRefs,
  );
  const seen = new Set<string>();
  const scorecard = (raw.scorecard ?? [])
    .filter((s) => CRITERIA.some((c) => c.key === s.criterion) && !seen.has(s.criterion) && seen.add(s.criterion))
    .map((s) => ({ criterion: s.criterion, score: clampScore(s.score), comment: cut(s.comment, OUTPUT_LIMITS.item) }));

  return {
    summary: cut(raw.summary, OUTPUT_LIMITS.summary) || "Агент не сформулировал краткий вывод.",
    stance: raw.stance,
    overallScore: clampScore(raw.overallScore),
    strengths: list(raw.strengths, OUTPUT_LIMITS.items, OUTPUT_LIMITS.item),
    weaknesses: list(raw.weaknesses, OUTPUT_LIMITS.items, OUTPUT_LIMITS.item),
    risks: (raw.risks ?? []).slice(0, OUTPUT_LIMITS.items).map((r) => ({
      title: cut(r.title, 120),
      severity: r.severity,
      description: cut(r.description, OUTPUT_LIMITS.item),
    })),
    claims,
    scorecard,
    confidence: raw.confidence,
    unknowns: list(raw.unknowns, OUTPUT_LIMITS.items, OUTPUT_LIMITS.item),
    recommendations: list(raw.recommendations, OUTPUT_LIMITS.items, OUTPUT_LIMITS.item),
    fullText: cut(raw.fullText, OUTPUT_LIMITS.fullText),
    downgraded,
  };
}

export function normalizeCrossExam(raw: CrossExamOutput, validAgentIds: Set<string>, maxIssues = 4): CrossExamOutput {
  return {
    issues: (raw.issues ?? [])
      .filter((i) => validAgentIds.has(i.originalAgentId) && validAgentIds.has(i.counterAgentId))
      .filter((i) => i.originalAgentId !== i.counterAgentId)
      .slice(0, maxIssues)
      .map((i) => ({
        issue: cut(i.issue, 200),
        originalAgentId: i.originalAgentId,
        originalArgument: cut(i.originalArgument, 500),
        counterAgentId: i.counterAgentId,
        counterArgument: cut(i.counterArgument, 500),
        resolution: cut(i.resolution, 500),
        impact: i.impact,
        resolved: Boolean(i.resolved),
      })),
  };
}

/**
 * Приводит вердикт к полному виду: ровно 10 критериев (недостающие берутся из
 * сводки агентов с низкой уверенностью), обрезка длины, баллы в 0–100.
 */
export function normalizeVerdict(raw: VerdictOutput, aggregated: AggregatedCriterion[]): VerdictOutput {
  const criteria: CriterionVerdict[] = CRITERIA.map((c) => {
    const given = raw.criteria?.find((x) => x.criterion === c.key);
    if (given) {
      return {
        criterion: c.key,
        score: clampScore(given.score),
        explanation: cut(given.explanation, 600),
        keyArguments: list(given.keyArguments, 4, OUTPUT_LIMITS.item),
        confidence: given.confidence,
        missingData: list(given.missingData, 4, OUTPUT_LIMITS.item),
      };
    }
    const agg = aggregated.find((a) => a.criterion === c.key);
    return {
      criterion: c.key,
      score: agg?.mean ?? 50,
      explanation: agg?.mean != null
        ? "Судья не оценил критерий явно; использовано среднее по оценкам агентов."
        : "Нет данных для оценки — использовано нейтральное значение.",
      keyArguments: [],
      confidence: "low",
      missingData: ["Явная оценка судьи по этому критерию"],
    };
  });

  return {
    decision: raw.decision,
    headline: cut(raw.headline, 160),
    summary: cut(raw.summary, 1200),
    reasoning: cut(raw.reasoning, 3000),
    weighedArguments: (raw.weighedArguments ?? []).slice(0, 10).map((w) => ({
      ...w,
      argument: cut(w.argument, OUTPUT_LIMITS.item),
      why: cut(w.why, OUTPUT_LIMITS.item),
    })),
    criteria,
    disagreements: list(raw.disagreements, 6, 400),
    topRisks: (raw.topRisks ?? []).slice(0, 3).map((r) => ({
      title: cut(r.title, 120),
      severity: r.severity,
      description: cut(r.description, 400),
    })),
    unknowns: list(raw.unknowns, 8, OUTPUT_LIMITS.item),
    changes: list(raw.changes, 8, OUTPUT_LIMITS.item),
    validateBeforeBuild: list(raw.validateBeforeBuild, 8, OUTPUT_LIMITS.item),
    mvp: cut(raw.mvp, 1200),
    demandTestPlan: list(raw.demandTestPlan, 8, OUTPUT_LIMITS.item),
    successCriteria: list(raw.successCriteria, 6, OUTPUT_LIMITS.item),
    failureCriteria: list(raw.failureCriteria, 6, OUTPUT_LIMITS.item),
    nextStep: cut(raw.nextStep, 500),
    conditionsForReview: list(raw.conditionsForReview, 6, OUTPUT_LIMITS.item),
  };
}
