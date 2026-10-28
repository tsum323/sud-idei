import { AGENT_IDS } from "./agents";
import type { AgentId, CaseBundle } from "./types";

export type CourtStage = "submission" | "evidence" | "analysis" | "cross" | "deliberation" | "verdict";

export const STAGE_LABEL: Record<CourtStage, string> = {
  submission: "Подача идеи",
  evidence: "Сбор доказательств",
  analysis: "Независимый анализ",
  cross: "Перекрёстная критика",
  deliberation: "Совещание судьи",
  verdict: "Вердикт оглашён",
};

/** Минимум заключений, при котором судья может вынести хотя бы предварительное решение. */
export const MIN_AGENTS_FOR_VERDICT = 3;

export interface CourtPlan {
  stage: CourtStage;
  needsEvidence: boolean;
  /** Агенты без результата (ожидают или завершились ошибкой). */
  pendingAgents: AgentId[];
  failedAgents: AgentId[];
  runningAgents: AgentId[];
  doneAgents: AgentId[];
  canCrossExam: boolean;
  needsCrossExam: boolean;
  canVerdict: boolean;
  needsVerdict: boolean;
  /** Вердикт будет предварительным, т.к. не все агенты дали заключения. */
  verdictWouldBePartial: boolean;
  finished: boolean;
}

/**
 * Определяет, какие этапы заседания остались. Используется для продолжения
 * прерванного заседания: повторно запускаются только незавершённые этапы.
 */
export function planCourt(bundle: CaseBundle, searchConfigured: boolean): CourtPlan {
  const { analyses, stages, verdict } = bundle;
  const byAgent = new Map(analyses.map((a) => [a.agentId, a]));
  const doneAgents = AGENT_IDS.filter((id) => byAgent.get(id)?.status === "done");
  const runningAgents = AGENT_IDS.filter((id) => byAgent.get(id)?.status === "running");
  const failedAgents = AGENT_IDS.filter((id) => byAgent.get(id)?.status === "error");
  const pendingAgents = AGENT_IDS.filter((id) => {
    const s = byAgent.get(id)?.status;
    return !s || s === "idle" || s === "error";
  });

  const finished = Boolean(verdict);
  const needsEvidence = !finished && searchConfigured && stages.evidence === "idle";
  const allSettled = runningAgents.length === 0 && pendingAgents.length === 0;
  const canCrossExam = !finished && runningAgents.length === 0 && doneAgents.length >= 2;
  const needsCrossExam = canCrossExam && allSettled && stages.crossExam !== "done";
  const crossSettled = stages.crossExam === "done" || stages.crossExam === "error";
  const canVerdict =
    !finished && runningAgents.length === 0 && stages.crossExam !== "running" && doneAgents.length >= MIN_AGENTS_FOR_VERDICT;
  const needsVerdict = canVerdict && allSettled && crossSettled;

  let stage: CourtStage = "submission";
  if (finished) stage = "verdict";
  else if (stages.verdict === "running" || (crossSettled && allSettled)) stage = "deliberation";
  else if (stages.crossExam === "running" || (allSettled && doneAgents.length > 0)) stage = "cross";
  else if (doneAgents.length || runningAgents.length || failedAgents.length) stage = "analysis";
  else if (needsEvidence || stages.evidence !== "idle") stage = "evidence";

  return {
    stage,
    needsEvidence,
    pendingAgents,
    failedAgents,
    runningAgents,
    doneAgents,
    canCrossExam,
    needsCrossExam,
    canVerdict,
    needsVerdict,
    verdictWouldBePartial: doneAgents.length < AGENT_IDS.length,
    finished,
  };
}

/** Примерное число платных вызовов модели для полного заседания. */
export function estimateCalls(plan: CourtPlan): number {
  return plan.pendingAgents.length + (plan.finished ? 0 : 2);
}
