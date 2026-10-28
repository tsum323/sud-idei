import type {
  AgentOutput,
  Claim,
  CriterionVerdict,
  Decision,
  OptionalContext,
  RiskItem,
  VerdictOutput,
  WeighedArgument,
} from "./schemas";

export type AgentId =
  | "prosecutor"
  | "advocate"
  | "market"
  | "finance"
  | "tech"
  | "product"
  | "growth"
  | "risk"
  | "independent";

/**
 * draft — дело создано, анализ не начат;
 * in_progress — идёт заседание (или оно прервано и может быть продолжено);
 * approved / conditional / rework — вердикт вынесен;
 * prison — идея отклонена и помещена в Тюрьму идей.
 */
export type CaseStatus = "draft" | "in_progress" | "approved" | "conditional" | "rework" | "prison";

export interface IdeaCase {
  id: string;
  number: number;
  title: string;
  description: string;
  optionalContext: OptionalContext;
  status: CaseStatus;
  /** Номер текущего заседания: 1 — первое рассмотрение, 2+ — пересмотры. */
  round: number;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
}

export type AnalysisStatus = "idle" | "running" | "done" | "error";

export interface AgentAnalysis extends Partial<AgentOutput> {
  id: string;
  caseId: string;
  round: number;
  agentId: AgentId;
  status: AnalysisStatus;
  error: string | null;
  attempts: number;
  provider: string;
  /** Сколько «фактов» без источника было понижено до предположений. */
  downgraded?: number;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceType = "competitor" | "market" | "pricing" | "platform_rules" | "general";

export interface Evidence {
  id: string;
  /** Короткая метка для ссылок из заключений: E1, E2… */
  ref: string;
  caseId: string;
  round: number;
  agentId: AgentId | null;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  snippet: string;
  checkedAt: string;
  evidenceType: EvidenceType;
}

export interface CrossExamination {
  id: string;
  caseId: string;
  round: number;
  issue: string;
  originalAgentId: string;
  originalArgument: string;
  counterAgentId: string;
  counterArgument: string;
  resolution: string;
  impact: "low" | "medium" | "high";
  resolved: boolean;
}

export interface Verdict
  extends Omit<VerdictOutput, "criteria" | "weighedArguments" | "topRisks"> {
  id: string;
  caseId: string;
  round: number;
  scores: CriterionVerdict[];
  weighedArguments: WeighedArgument[];
  risks: RiskItem[];
  overallScore: number;
  /** true, если часть агентов не дала заключения и решение предварительное. */
  isPreliminary: boolean;
  basedOnAgents: AgentId[];
  missingAgents: AgentId[];
  evidenceUsed: number;
  /** Утверждения, помеченные моделью как факты, но не подкреплённые источником. */
  downgradedClaims: number;
  provider: string;
  createdAt: string;
}

export interface ActionPlan {
  id: string;
  caseId: string;
  round: number;
  steps: string[];
  validationCriteria: { success: string[]; failure: string[] };
  nextAction: string;
}

export type CaseEventType =
  | "created"
  | "evidence_collected"
  | "evidence_skipped"
  | "agent_started"
  | "agent_done"
  | "agent_error"
  | "cross_exam_done"
  | "cross_exam_error"
  | "verdict_done"
  | "verdict_error"
  | "imprisoned"
  | "reopened";

export interface CaseEvent {
  id: string;
  caseId: string;
  round: number;
  eventType: CaseEventType;
  description: string;
  createdAt: string;
}

export interface StageState {
  evidence: "idle" | "done" | "skipped" | "error";
  crossExam: AnalysisStatus;
  verdict: AnalysisStatus;
  crossExamError: string | null;
  verdictError: string | null;
}

export interface CaseBundle {
  case: IdeaCase;
  analyses: AgentAnalysis[];
  evidence: Evidence[];
  crossExaminations: CrossExamination[];
  verdict: Verdict | null;
  actionPlan: ActionPlan | null;
  events: CaseEvent[];
  stages: StageState;
  /** Вердикты прошлых заседаний — история рассмотрения. */
  previousVerdicts: Verdict[];
}

export interface CaseSummary {
  id: string;
  number: number;
  title: string;
  status: CaseStatus;
  round: number;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
  decision: Decision | null;
  overallScore: number | null;
  headline: string | null;
  topRisk: string | null;
  conditionsForReview: string[];
}

export interface AppSettings {
  provider: "claude-code" | "anthropic-api" | "claude-artifact";
  providerLabel: string;
  /** subscription — расходует лимиты подписки Claude; api — оплата по токенам; null — провайдер не готов. */
  billing: "subscription" | "api" | null;
  model: string | null;
  effort: string | null;
  paid: boolean;
  configured: boolean;
  configError: string | null;
  search: { provider: "none" | "tavily"; configured: boolean };
  databasePath: string;
  /** Сколько запросов к модели разрешено одновременно (ограничение среды). */
  maxConcurrency?: number;
}

export type { Claim };
