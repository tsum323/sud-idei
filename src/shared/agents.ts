import type { AgentId } from "./types";

export interface AgentMeta {
  id: AgentId;
  name: string;
  /** Короткая подпись под персонажем. */
  short: string;
  role: string;
  visualStyle: { accent: string; description: string };
}

/** Публичные сведения об агентах. Инструкции (system prompt) живут только на сервере. */
export const AGENTS: AgentMeta[] = [
  {
    id: "prosecutor",
    name: "Прокурор-скептик",
    short: "Прокурор",
    role: "Ищет реальные причины, по которым идея может провалиться",
    visualStyle: { accent: "#e2483d", description: "Нахмуренные брови, красный галстук, лупа" },
  },
  {
    id: "advocate",
    name: "Адвокат идеи",
    short: "Адвокат",
    role: "Ищет сильные стороны и сценарии успеха без слепой похвалы",
    visualStyle: { accent: "#4f8fe8", description: "Улыбка, синяя бабочка, портфель" },
  },
  {
    id: "market",
    name: "Рыночный аналитик",
    short: "Рынок",
    role: "Аудитория, проблема, конкуренты и спрос",
    visualStyle: { accent: "#3fc1c9", description: "Круглые очки, табличка с графиком" },
  },
  {
    id: "finance",
    name: "Финансовый эксперт",
    short: "Финансы",
    role: "Монетизация, расходы и экономика продукта",
    visualStyle: { accent: "#57c26b", description: "Зелёный козырёк, золотая монета" },
  },
  {
    id: "tech",
    name: "Технический архитектор",
    short: "Техника",
    role: "Сложность реализации, стек и минимальный MVP",
    visualStyle: { accent: "#f2c443", description: "Жёлтая каска, гаечный ключ" },
  },
  {
    id: "product",
    name: "Продуктовый стратег",
    short: "Продукт",
    role: "Ключевая ценность, главная функция и проверяемая гипотеза",
    visualStyle: { accent: "#b07be8", description: "Фиолетовый берет, мишень" },
  },
  {
    id: "growth",
    name: "Эксперт по привлечению",
    short: "Рост",
    role: "Каналы продвижения и первые пользователи без бюджета",
    visualStyle: { accent: "#ff7fb0", description: "Кепка, мегафон" },
  },
  {
    id: "risk",
    name: "Аналитик рисков",
    short: "Риски",
    role: "Юридические, платформенные, репутационные и операционные риски",
    visualStyle: { accent: "#ff9e3d", description: "Шлем с полосами, знак опасности" },
  },
  {
    id: "independent",
    name: "Независимый эксперт",
    short: "Эксперт",
    role: "Проверяет логику остальных и ищет упущенное",
    visualStyle: { accent: "#c9c3b5", description: "Седая борода, монокль" },
  },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);

export function agentMeta(id: string): AgentMeta | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function agentName(id: string): string {
  return agentMeta(id)?.name ?? (id === "judge" ? "Главный судья" : id);
}

export function isAgentId(id: string): id is AgentId {
  return AGENT_IDS.includes(id as AgentId);
}
