import type { z } from "zod";
import type { AgentId, AgentAnalysis, CrossExamination, Evidence, IdeaCase } from "@/shared/types";
import type { AggregatedCriterion } from "@/shared/scoring";

/** Структурированные входные данные задачи (используются тестовым провайдером и для журнала). */
export type AITaskInput =
  | { task: "agent"; agentId: AgentId; idea: IdeaCase; evidence: Evidence[] }
  | { task: "cross_exam"; idea: IdeaCase; analyses: AgentAnalysis[] }
  | {
      task: "verdict";
      idea: IdeaCase;
      analyses: AgentAnalysis[];
      crossExaminations: CrossExamination[];
      evidence: Evidence[];
      aggregated: AggregatedCriterion[];
      missingAgents: AgentId[];
    };

export interface AIRequest<T> {
  input: AITaskInput;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  /** Платный ли провайдер — от этого зависят предупреждения в интерфейсе. */
  readonly paid: boolean;
  readonly model: string | null;
  generate<T>(req: AIRequest<T>): Promise<T>;
}
