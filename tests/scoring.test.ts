import { describe, expect, it } from "vitest";
import { CRITERIA } from "@/shared/criteria";
import { enforceEvidence, normalizeVerdict } from "@/shared/normalize";
import { aggregateAgentScores, computeOverallScore, findScoreConflicts, suggestDecision } from "@/shared/scoring";
import type { AgentAnalysis } from "@/shared/types";
import type { VerdictOutput } from "@/shared/schemas";

const all = (score: number) => CRITERIA.map((c) => ({ criterion: c.key, score }));

function analysis(agentId: AgentAnalysis["agentId"], scores: Record<string, number>, status: AgentAnalysis["status"] = "done"): AgentAnalysis {
  return {
    id: agentId, caseId: "c", round: 1, agentId, status, error: null, attempts: 1, provider: "t",
    createdAt: "", updatedAt: "",
    scorecard: Object.entries(scores).map(([criterion, score]) => ({ criterion: criterion as never, score, comment: "" })),
  };
}

describe("расчёт оценок", () => {
  it("общий балл — взвешенное среднее с ограничением 0–100", () => {
    expect(computeOverallScore(all(70))).toBe(70);
    expect(computeOverallScore([{ criterion: "problem_reality", score: 150 }])).toBe(100);
    expect(computeOverallScore([])).toBe(0);
  });

  it("низкая оценка по одному критерию не приводит к отклонению", () => {
    const criteria = all(75).map((c) => (c.criterion === "launch_simplicity" ? { ...c, score: 5 } : c));
    const overall = computeOverallScore(criteria);
    const d = suggestDecision({ overallScore: overall, criteria, unresolvedCriticalRisks: 0 });
    expect(d).not.toBe("rejected");
  });

  it("отсутствие и проблемы, и спроса — фундаментальный провал", () => {
    const criteria = all(60).map((c) =>
      c.criterion === "problem_reality" || c.criterion === "demand_potential" ? { ...c, score: 10 } : c,
    );
    expect(suggestDecision({ overallScore: computeOverallScore(criteria), criteria, unresolvedCriticalRisks: 0 })).toBe("rejected");
  });

  it("решения по уровням", () => {
    expect(suggestDecision({ overallScore: 80, criteria: all(80), unresolvedCriticalRisks: 0 })).toBe("approved");
    expect(suggestDecision({ overallScore: 80, criteria: all(80), unresolvedCriticalRisks: 1 })).toBe("conditional");
    expect(suggestDecision({ overallScore: 50, criteria: all(50), unresolvedCriticalRisks: 0 })).toBe("rework");
    expect(suggestDecision({ overallScore: 30, criteria: all(30), unresolvedCriticalRisks: 0 })).toBe("rejected");
  });

  it("сводка агентов учитывает только завершённые анализы и находит разногласия", () => {
    const list = [
      analysis("advocate", { demand_potential: 85 }),
      analysis("prosecutor", { demand_potential: 30 }),
      analysis("market", { demand_potential: 0 }, "error"),
    ];
    const agg = aggregateAgentScores(list).find((a) => a.criterion === "demand_potential")!;
    expect(agg.votes).toBe(2);
    expect(agg.mean).toBe(58);
    expect(findScoreConflicts(list).map((c) => c.criterion)).toEqual(["demand_potential"]);
  });
});

describe("факты и предположения", () => {
  it("«факт» без ссылки на существующее доказательство понижается до предположения", () => {
    const { claims, downgraded } = enforceEvidence(
      [
        { statement: "Рынок растёт на 40% в год", kind: "fact", evidenceIds: [] },
        { statement: "Есть конкурент X", kind: "fact", evidenceIds: ["E1"] },
        { statement: "Ссылка на несуществующий источник", kind: "fact", evidenceIds: ["E9"] },
      ],
      new Set(["E1"]),
    );
    expect(claims.map((c) => c.kind)).toEqual(["assumption", "fact", "assumption"]);
    expect(claims[2].evidenceIds).toEqual([]);
    expect(downgraded).toBe(2);
  });

  it("вердикт всегда содержит 10 критериев; пропущенные помечены низкой уверенностью", () => {
    const raw = { criteria: [{ criterion: "monetization", score: 140, explanation: "x", keyArguments: [], confidence: "high", missingData: [] }] } as unknown as VerdictOutput;
    const v = normalizeVerdict({ ...raw, decision: "rework" } as VerdictOutput, aggregateAgentScores([analysis("finance", { tech_feasibility: 64 })]));
    expect(v.criteria).toHaveLength(10);
    expect(v.criteria.find((c) => c.criterion === "monetization")!.score).toBe(100);
    const tech = v.criteria.find((c) => c.criterion === "tech_feasibility")!;
    expect(tech.score).toBe(64);
    expect(tech.confidence).toBe("low");
  });
});
