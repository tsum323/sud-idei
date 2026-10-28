import { z } from "zod";
import { CRITERION_KEYS } from "./criteria";

/* ------------------------------------------------------------------ */
/* Пользовательский ввод                                               */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  title: 120,
  description: 4000,
  optionalField: 1000,
  newGrounds: 2000,
} as const;

const optionalText = z
  .string()
  .trim()
  .max(LIMITS.optionalField, `Не более ${LIMITS.optionalField} символов`)
  .transform((v) => (v ? v : undefined))
  .optional();

export const OptionalContextSchema = z.object({
  audience: optionalText,
  problem: optionalText,
  monetization: optionalText,
  resources: optionalText,
  constraints: optionalText,
  comments: optionalText,
});
export type OptionalContext = Partial<Record<keyof z.infer<typeof OptionalContextSchema>, string>>;

export const OPTIONAL_CONTEXT_LABELS: Record<keyof OptionalContext, string> = {
  audience: "Целевая аудитория",
  problem: "Проблема, которую решает идея",
  monetization: "Возможная монетизация",
  resources: "Доступные ресурсы",
  constraints: "Ограничения",
  comments: "Дополнительные комментарии",
};

export const NewIdeaSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Название слишком короткое (минимум 3 символа)")
    .max(LIMITS.title, `Название не длиннее ${LIMITS.title} символов`),
  description: z
    .string()
    .trim()
    .min(20, "Опишите идею хотя бы в 20 символах")
    .max(LIMITS.description, `Описание не длиннее ${LIMITS.description} символов`),
  optionalContext: OptionalContextSchema.default({}),
});
export type NewIdeaInput = z.input<typeof NewIdeaSchema>;
export type NewIdea = z.output<typeof NewIdeaSchema>;

export const ReopenSchema = z.object({
  newGrounds: z
    .string()
    .trim()
    .min(20, "Опишите новые основания для пересмотра (минимум 20 символов)")
    .max(LIMITS.newGrounds),
  description: z.string().trim().min(20).max(LIMITS.description).optional(),
});

/* ------------------------------------------------------------------ */
/* Ответы моделей. Схемы намеренно без числовых ограничений: структурированный
 * вывод их не всегда поддерживает, поэтому границы применяются при нормализации. */
/* ------------------------------------------------------------------ */

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const ClaimKind = z.enum(["fact", "assumption", "estimate"]);
export type ClaimKind = z.infer<typeof ClaimKind>;

export const RiskItem = z.object({
  title: z.string(),
  severity: Severity,
  description: z.string(),
});
export type RiskItem = z.infer<typeof RiskItem>;

export const Claim = z.object({
  statement: z.string(),
  kind: ClaimKind,
  /** Идентификаторы доказательств (E1, E2…), на которые опирается утверждение. */
  evidenceIds: z.array(z.string()),
});
export type Claim = z.infer<typeof Claim>;

export const AgentScore = z.object({
  criterion: z.enum(CRITERION_KEYS),
  score: z.number(),
  comment: z.string(),
});
export type AgentScore = z.infer<typeof AgentScore>;

export const AgentOutputSchema = z.object({
  summary: z.string(),
  stance: z.enum(["support", "neutral", "oppose"]),
  overallScore: z.number(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  risks: z.array(RiskItem),
  claims: z.array(Claim),
  scorecard: z.array(AgentScore),
  confidence: Confidence,
  unknowns: z.array(z.string()),
  recommendations: z.array(z.string()),
  fullText: z.string(),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const CrossExamOutputSchema = z.object({
  issues: z.array(
    z.object({
      issue: z.string(),
      originalAgentId: z.string(),
      originalArgument: z.string(),
      counterAgentId: z.string(),
      counterArgument: z.string(),
      resolution: z.string(),
      impact: z.enum(["low", "medium", "high"]),
      resolved: z.boolean(),
    }),
  ),
});
export type CrossExamOutput = z.infer<typeof CrossExamOutputSchema>;

export const Decision = z.enum(["approved", "conditional", "rework", "rejected"]);
export type Decision = z.infer<typeof Decision>;

export const CriterionVerdict = z.object({
  criterion: z.enum(CRITERION_KEYS),
  score: z.number(),
  explanation: z.string(),
  keyArguments: z.array(z.string()),
  confidence: Confidence,
  missingData: z.array(z.string()),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdict>;

export const WeighedArgument = z.object({
  side: z.enum(["defense", "prosecution"]),
  argument: z.string(),
  agentId: z.string(),
  weight: z.enum(["decisive", "significant", "minor"]),
  why: z.string(),
});
export type WeighedArgument = z.infer<typeof WeighedArgument>;

export const VerdictOutputSchema = z.object({
  decision: Decision,
  headline: z.string(),
  summary: z.string(),
  reasoning: z.string(),
  weighedArguments: z.array(WeighedArgument),
  criteria: z.array(CriterionVerdict),
  disagreements: z.array(z.string()),
  topRisks: z.array(RiskItem),
  unknowns: z.array(z.string()),
  changes: z.array(z.string()),
  validateBeforeBuild: z.array(z.string()),
  mvp: z.string(),
  demandTestPlan: z.array(z.string()),
  successCriteria: z.array(z.string()),
  failureCriteria: z.array(z.string()),
  nextStep: z.string(),
  conditionsForReview: z.array(z.string()),
});
export type VerdictOutput = z.infer<typeof VerdictOutputSchema>;
