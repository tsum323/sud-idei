import "server-only";
import { AGENT_IDS } from "@/shared/agents";
import { normalizeVerdict } from "@/shared/normalize";
import { VerdictOutputSchema, type VerdictOutput } from "@/shared/schemas";
import {
  aggregateAgentScores,
  computeOverallScore,
  countCriticalRisks,
  DECISION_LABEL,
  suggestDecision,
} from "@/shared/scoring";
import type { AgentAnalysis, AgentId, CrossExamination, Evidence, IdeaCase, Verdict } from "@/shared/types";
import type { AIProvider } from "../ai/types";
import { JUDGE_SYSTEM, judgePrompt } from "../court/prompts";

export interface JudgeInput {
  idea: IdeaCase;
  analyses: AgentAnalysis[];
  crossExaminations: CrossExamination[];
  crossExamFailed: boolean;
  evidence: Evidence[];
}

export type JudgeResult = Omit<Verdict, "id" | "createdAt" | "caseId" | "round">;

/**
 * Главный судья. Модель выносит решение и оценки; код достраивает недостающие
 * критерии, считает общий балл и фиксирует, на каких данных основано решение.
 */
export async function runJudge(
  provider: AIProvider,
  input: JudgeInput,
  call: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn(),
): Promise<JudgeResult> {
  const done = input.analyses.filter((a) => a.status === "done");
  const basedOnAgents = done.map((a) => a.agentId);
  const missingAgents: AgentId[] = AGENT_IDS.filter((id) => !basedOnAgents.includes(id));
  const aggregated = aggregateAgentScores(done);

  const refCriteria = aggregated.map((a) => ({ criterion: a.criterion, score: a.mean ?? 50 }));
  const refScore = computeOverallScore(refCriteria);
  const refDecision = suggestDecision({
    overallScore: refScore,
    criteria: refCriteria,
    unresolvedCriticalRisks: countCriticalRisks(done.flatMap((a) => a.risks ?? [])),
  });

  const raw = await call(() =>
    provider.generate<VerdictOutput>({
      input: {
        task: "verdict",
        idea: input.idea,
        analyses: done,
        crossExaminations: input.crossExaminations,
        evidence: input.evidence,
        aggregated,
        missingAgents,
      },
      system: JUDGE_SYSTEM,
      prompt: judgePrompt({
        idea: input.idea,
        analyses: done,
        crossExaminations: input.crossExaminations,
        evidence: input.evidence,
        aggregated,
        missingAgents,
        reference: { overallScore: refScore, decision: DECISION_LABEL[refDecision] },
        crossExamFailed: input.crossExamFailed,
      }),
      schema: VerdictOutputSchema,
      maxTokens: 16000,
    }),
  );

  const v = normalizeVerdict(raw, aggregated);
  const isPreliminary = missingAgents.length > 0;
  const limitations = [
    ...(isPreliminary ? [`Не получены заключения ${missingAgents.length} из ${AGENT_IDS.length} агентов`] : []),
    ...(input.crossExamFailed ? ["Перекрёстная критика не состоялась"] : []),
    ...(input.evidence.length === 0 ? ["Актуальные данные не проверялись веб-поиском"] : []),
  ];

  const { criteria, topRisks, ...rest } = v;
  return {
    ...rest,
    unknowns: [...new Set([...v.unknowns, ...limitations])],
    scores: criteria,
    risks: topRisks,
    overallScore: computeOverallScore(criteria),
    isPreliminary,
    basedOnAgents,
    missingAgents,
    evidenceUsed: input.evidence.length,
    downgradedClaims: done.reduce((n, a) => n + (a.downgraded ?? 0), 0),
    provider: provider.label,
  };
}
