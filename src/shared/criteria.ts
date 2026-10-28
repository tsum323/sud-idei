/**
 * Десять критериев оценки идеи. Шкала 0–100, где 100 — всегда «лучше для идеи».
 * Для критерия рисков это значит «риски низкие/управляемые».
 */
export const CRITERIA = [
  { key: "problem_reality", label: "Реальность проблемы", weight: 1.3 },
  { key: "demand_potential", label: "Потенциал спроса", weight: 1.3 },
  { key: "differentiation", label: "Отличие от существующих решений", weight: 1.0 },
  { key: "monetization", label: "Потенциал монетизации", weight: 1.1 },
  { key: "tech_feasibility", label: "Техническая реализуемость", weight: 0.9 },
  { key: "launch_simplicity", label: "Простота запуска", weight: 0.8 },
  { key: "acquisition", label: "Возможности привлечения пользователей", weight: 1.0 },
  { key: "competitive_advantage", label: "Конкурентные преимущества", weight: 0.9 },
  { key: "risk_level", label: "Уровень рисков (100 = риски низкие)", weight: 1.0 },
  { key: "data_quality", label: "Качество исходных данных", weight: 0.7 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const CRITERION_KEYS = CRITERIA.map((c) => c.key) as [CriterionKey, ...CriterionKey[]];

export function criterionLabel(key: string): string {
  return CRITERIA.find((c) => c.key === key)?.label ?? key;
}
