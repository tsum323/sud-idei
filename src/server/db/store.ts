import type { AgentOutput, Decision, NewIdea } from "@/shared/schemas";
import type {
  ActionPlan,
  AgentAnalysis,
  AgentId,
  CaseBundle,
  CaseEvent,
  CaseEventType,
  CaseStatus,
  CaseSummary,
  CrossExamination,
  Evidence,
  IdeaCase,
  StageState,
  Verdict,
} from "@/shared/types";

export const DECISION_TO_STATUS: Record<Decision, CaseStatus> = {
  approved: "approved",
  conditional: "conditional",
  rework: "rework",
  rejected: "prison",
};

export class CaseNotFoundError extends Error {
  constructor(id: string) {
    super(`Дело ${id} не найдено`);
  }
}

/**
 * Хранилище дел, на которое опирается служба заседаний. Реализации: CourtRepo
 * (SQLite на сервере) и MemoryStore (страница-артефакт с хранилищем claude.ai).
 */
export interface CourtStore {
  upsertAgents(agents: { id: string; name: string; role: string; systemPrompt: string; visualStyle: unknown }[]): void;
  createCase(idea: NewIdea): IdeaCase;
  getCase(id: string): IdeaCase;
  listCases(filter?: { query?: string; status?: CaseStatus | "all" }): CaseSummary[];
  getBundle(caseId: string): CaseBundle;
  getStages(caseId: string, round: number): StageState;
  tryStartStage(caseId: string, round: number, stage: "cross_exam" | "verdict"): boolean;
  setStage(caseId: string, round: number, stage: "evidence" | "cross_exam" | "verdict", status: string, error?: string | null): void;
  getAnalyses(caseId: string, round: number): AgentAnalysis[];
  getAnalysis(caseId: string, round: number, agentId: AgentId): AgentAnalysis | undefined;
  tryStartAgent(caseId: string, round: number, agentId: AgentId, provider: string): boolean;
  saveAgentResult(caseId: string, round: number, agentId: AgentId, output: AgentOutput): void;
  saveAgentError(caseId: string, round: number, agentId: AgentId, error: string): void;
  getEvidence(caseId: string, round: number): Evidence[];
  saveEvidence(caseId: string, round: number, items: Omit<Evidence, "id" | "ref" | "caseId" | "round">[]): void;
  getCrossExaminations(caseId: string, round: number): CrossExamination[];
  saveCrossExaminations(caseId: string, round: number, items: Omit<CrossExamination, "id" | "caseId" | "round">[]): void;
  saveVerdict(verdict: Omit<Verdict, "id" | "createdAt">, plan: Omit<ActionPlan, "id">): Verdict;
  reopenCase(caseId: string, newGrounds: string, newDescription?: string): IdeaCase;
  addEvent(caseId: string, round: number, type: CaseEventType, description: string): CaseEvent;
}

