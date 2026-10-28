import "server-only";
import { agentName } from "@/shared/agents";
import { CRITERIA, type CriterionKey } from "@/shared/criteria";
import type { AgentOutput, AgentScore, Claim, CrossExamOutput, RiskItem, VerdictOutput } from "@/shared/schemas";
import { clampScore, computeOverallScore, countCriticalRisks, suggestDecision } from "@/shared/scoring";
import type { AgentAnalysis, AgentId, Evidence, IdeaCase } from "@/shared/types";
import { AIError } from "./errors";
import type { AIProvider, AIRequest, AITaskInput } from "./types";

/**
 * Демонстрационный провайдер. Не обращается к сети и ничего не стоит.
 * Заключения строятся шаблонами по ключевым словам описания — это тестовые данные,
 * а не настоящий анализ, и в интерфейсе они помечены как демо.
 */

interface Signals {
  seed: number;
  text: string;
  filled: number;
  richness: number;
  hasAudience: boolean;
  hasProblem: boolean;
  hasMonetization: boolean;
  hasResources: boolean;
  isAI: boolean;
  isContent: boolean;
  isB2B: boolean;
  isMarketplace: boolean;
  isMobile: boolean;
  isHardware: boolean;
  isRegulated: boolean;
  isSubscription: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function extractSignals(idea: IdeaCase): Signals {
  const ctx = idea.optionalContext ?? {};
  const text = [idea.title, idea.description, ...Object.values(ctx)].join(" ").toLowerCase();
  const has = (re: RegExp) => re.test(text);
  const filled = Object.values(ctx).filter(Boolean).length;
  const richness = Math.min(1, idea.description.length / 900 + filled * 0.12);
  return {
    seed: hash(idea.title + idea.description + idea.round),
    text,
    filled,
    richness,
    hasAudience: Boolean(ctx.audience) || has(/для (малого|студент|родител|разработчик|фрилансер|компани|бизнес|учител|врач)/),
    hasProblem: Boolean(ctx.problem) || has(/проблем|боль|тратят|сложно|неудобно|теряют/),
    hasMonetization: Boolean(ctx.monetization) || has(/подписк|платн|комисси|тариф|продаж|реклам|\$|₽|руб/),
    hasResources: Boolean(ctx.resources),
    isAI: has(/\bai\b|ии\b|нейросет|gpt|claude|llm|искусственн/),
    isContent: has(/youtube|ютуб|канал|блог|подкаст|контент|tiktok|телеграм/),
    isB2B: has(/b2b|компани|бизнес|предприят|корпоратив|отдел/),
    isMarketplace: has(/маркетплейс|площадк|агрегатор|исполнител/),
    isMobile: has(/мобильн|ios|android|приложени/),
    isHardware: has(/устройств|датчик|железо|гаджет|производств/),
    isRegulated: has(/медицин|здоров|финанс|кредит|страхов|юрид|дет(ей|и)\b|персональн/),
    isSubscription: has(/подписк|saas|ежемесяч/),
  };
}

/** Детерминированный «шум» ±range, чтобы разные идеи получали разные оценки. */
function jitter(s: Signals, salt: string, range: number): number {
  return ((hash(String(s.seed) + salt) % (range * 2 + 1)) - range);
}

function baseScores(s: Signals): Record<CriterionKey, number> {
  const r = s.richness;
  return {
    problem_reality: 42 + (s.hasProblem ? 20 : 0) + r * 12,
    demand_potential: 40 + (s.hasAudience ? 12 : 0) + (s.isB2B ? 6 : 0) + r * 10,
    differentiation: 45 + (s.isAI ? -6 : 4) + r * 8,
    monetization: 35 + (s.hasMonetization ? 22 : 0) + (s.isB2B ? 8 : 0) + (s.isContent ? -6 : 0),
    tech_feasibility: 70 + (s.isHardware ? -25 : 0) + (s.isAI ? -6 : 0) + (s.isMarketplace ? -6 : 0),
    launch_simplicity: 62 + (s.isHardware ? -25 : 0) + (s.isMarketplace ? -14 : 0) + (s.isRegulated ? -12 : 0),
    acquisition: 44 + (s.isContent ? 12 : 0) + (s.hasAudience ? 8 : 0) + (s.isMarketplace ? -8 : 0),
    competitive_advantage: 40 + r * 14 + (s.hasResources ? 6 : 0),
    risk_level: 64 + (s.isRegulated ? -22 : 0) + (s.isAI ? -6 : 0) + (s.isContent ? -4 : 0),
    data_quality: 25 + s.filled * 10 + Math.min(25, s.text.length / 40),
  };
}

const RELEVANT: Record<AgentId, CriterionKey[]> = {
  prosecutor: ["problem_reality", "demand_potential", "acquisition", "risk_level"],
  advocate: ["problem_reality", "differentiation", "competitive_advantage", "monetization"],
  market: ["problem_reality", "demand_potential", "differentiation", "competitive_advantage"],
  finance: ["monetization", "launch_simplicity", "risk_level"],
  tech: ["tech_feasibility", "launch_simplicity"],
  product: ["problem_reality", "differentiation", "launch_simplicity"],
  growth: ["acquisition", "demand_potential"],
  risk: ["risk_level", "launch_simplicity"],
  independent: ["data_quality", "problem_reality", "demand_potential"],
};

const BIAS: Record<AgentId, number> = {
  prosecutor: -14,
  advocate: 12,
  market: 0,
  finance: -4,
  tech: 4,
  product: 2,
  growth: 0,
  risk: -8,
  independent: -2,
};

const COMMENT: Record<CriterionKey, [string, string]> = {
  problem_reality: ["Проблема описана конкретно и выглядит реальной", "Проблема сформулирована общо, нет примеров пользователей"],
  demand_potential: ["Есть основания ожидать интерес целевой группы", "Спрос не подтверждён ни интервью, ни предзаказами"],
  differentiation: ["Есть понятное отличие от типовых решений", "Отличие от существующих аналогов не очевидно"],
  monetization: ["Модель дохода названа и выглядит реалистично", "Не ясно, кто и за что будет платить"],
  tech_feasibility: ["MVP реализуем стандартными средствами", "Реализация требует сложной инфраструктуры"],
  launch_simplicity: ["Первую версию можно запустить быстро", "Запуск потребует заметных ресурсов и времени"],
  acquisition: ["Есть доступные каналы для первых пользователей", "Каналы привлечения не определены"],
  competitive_advantage: ["Есть задел для устойчивого преимущества", "Преимущество легко скопировать"],
  risk_level: ["Критических рисков не видно", "Есть существенные внешние риски"],
  data_quality: ["Исходных данных достаточно для предварительной оценки", "Исходных данных мало — выводы предварительные"],
};

function agentScorecard(id: AgentId, s: Signals): AgentScore[] {
  const base = baseScores(s);
  return RELEVANT[id].map((k) => {
    const score = clampScore(base[k] + BIAS[id] + jitter(s, id + k, 6));
    return { criterion: k, score, comment: COMMENT[k][score >= 55 ? 0 : 1] };
  });
}

function stanceOf(score: number): AgentOutput["stance"] {
  return score >= 60 ? "support" : score <= 42 ? "oppose" : "neutral";
}

const a = (statement: string, kind: Claim["kind"] = "assumption", evidenceIds: string[] = []): Claim => ({ statement, kind, evidenceIds });

function commonUnknowns(s: Signals): string[] {
  const u: string[] = [];
  if (!s.hasAudience) u.push("Кто конкретно целевой пользователь");
  if (!s.hasProblem) u.push("Насколько остро пользователи ощущают проблему");
  if (!s.hasMonetization) u.push("Готовность платить и модель дохода");
  if (!s.hasResources) u.push("Доступные время, бюджет и навыки");
  return u;
}

function demoAgent(id: AgentId, idea: IdeaCase, evidence: Evidence[], s: Signals): AgentOutput {
  const scorecard = agentScorecard(id, s);
  const overallScore = clampScore(scorecard.reduce((x, y) => x + y.score, 0) / scorecard.length);
  const t = idea.title;
  const unknowns = commonUnknowns(s);
  const competitorEvidence = evidence.filter((e) => e.evidenceType === "competitor").slice(0, 2);
  const risks: RiskItem[] = [];
  let summary = "";
  let strengths: string[] = [];
  let weaknesses: string[] = [];
  let claims: Claim[] = [];
  let recommendations: string[] = [];

  switch (id) {
    case "prosecutor":
      summary = s.hasProblem
        ? `Проблема названа, но спрос на «${t}» не доказан: нет данных, что пользователи выберут это вместо привычных решений.`
        : `Главная слабость «${t}» — не сформулирована конкретная проблема пользователя и не доказан спрос.`;
      weaknesses = [
        "Нет подтверждения спроса (интервью, предзаказы, лист ожидания)",
        s.hasAudience ? "Аудитория названа, но не сегментирована" : "Целевая аудитория не определена",
        s.hasMonetization ? "Готовность платить не проверена" : "Не ясно, кто будет платить",
      ];
      strengths = ["Идею можно быстро проверить дешёвым тестом"];
      risks.push({ title: "Отсутствие подтверждённого спроса", severity: "high", description: "Продукт может оказаться «интересным», но ненужным настолько, чтобы им пользоваться регулярно." });
      if (s.isMarketplace) risks.push({ title: "Проблема курицы и яйца", severity: "high", description: "Площадке нужны обе стороны одновременно — это дорого на старте." });
      claims = [a("Пользователи уже решают эту задачу привычными способами и будут сопротивляться смене инструмента"), a("Без доказательств спроса разработка полноценной версии преждевременна")];
      recommendations = ["Провести 10–15 интервью с потенциальными пользователями до разработки", "Сформулировать критерий, при котором идея будет признана несостоятельной"];
      break;
    case "advocate":
      summary = `У «${t}» есть понятная ценность${s.hasAudience ? " для названной аудитории" : ""}; первую версию можно сделать узкой и дешёвой, что снижает цену ошибки.`;
      strengths = [
        s.hasProblem ? "Идея отталкивается от конкретной проблемы" : "Идея затрагивает знакомую многим задачу",
        "Можно начать с узкой ниши и расширяться после подтверждения",
        s.isAI ? "Современные модели позволяют сделать то, что раньше требовало команды" : "Не требует уникальных технологий для старта",
      ];
      weaknesses = ["Сильные стороны пока гипотетические — нужны подтверждения от пользователей"];
      claims = [a("Узкая ниша с острой проблемой может принять продукт быстрее широкого рынка"), a("Ручное исполнение части функций позволит проверить ценность без большой разработки", "estimate")];
      recommendations = ["Выбрать самый острый сценарий использования и сделать только его", "Рассмотреть вариант «сервис руками» вместо продукта на первом этапе"];
      break;
    case "market":
      summary = competitorEvidence.length
        ? `Найдены существующие решения — рынок есть, но нужно чёткое отличие «${t}» от них.`
        : `Без проверенных данных о рынке размер спроса и конкуренты для «${t}» остаются неопределёнными.`;
      strengths = s.hasAudience ? ["Целевая аудитория обозначена"] : [];
      weaknesses = ["Нет данных о размере сегмента", "Не проведён анализ альтернатив, которыми пользуются сейчас"];
      claims = [
        ...competitorEvidence.map((e) => a(`Существует похожее решение: ${e.sourceTitle}`, "fact", [e.ref])),
        a("Пользователи, скорее всего, сейчас решают задачу вручную, таблицами или универсальными сервисами"),
        a("Сегмент может быть достаточным для личного или нишевого проекта, но это требует проверки", "estimate"),
      ];
      if (!evidence.length) unknowns.push("Актуальные конкуренты и цены (веб-поиск не проводился)");
      recommendations = ["Составить список из 5–10 альтернатив и выписать, чем они не устраивают пользователей"];
      break;
    case "finance":
      summary = s.hasMonetization
        ? `Способ монетизации назван, но экономика «${t}» не проверена: неизвестны стоимость привлечения клиента и средний чек.`
        : `Монетизация «${t}» не определена — пока невозможно оценить экономику продукта.`;
      strengths = ["Проверку гипотезы можно провести с минимальным бюджетом", ...(s.isSubscription ? ["Подписочная модель даёт повторяющийся доход"] : [])];
      weaknesses = ["Нет оценки стоимости привлечения клиента", s.isAI ? "Переменные расходы на AI-вызовы растут вместе с пользователями" : "Регулярные расходы не оценены"];
      risks.push({ title: "Непроверенная юнит-экономика", severity: "medium", description: "Доход с клиента может не покрыть затраты на его привлечение и обслуживание." });
      claims = [a("Первоначальные расходы на MVP можно удержать в пределах личного бюджета, если не нанимать команду", "estimate"), a("Точные доходы и расходы без исходных данных оценить нельзя")];
      unknowns.push("Ожидаемый средний чек", "Стоимость привлечения одного клиента");
      recommendations = ["Проверить готовность платить через страницу с ценой или предзаказ", "Посчитать расход на одного активного пользователя"];
      break;
    case "tech":
      summary = s.isHardware
        ? `«${t}» требует работы с устройствами — MVP сложнее программного; стоит начать с прототипа на готовых компонентах.`
        : `Первую версию «${t}» можно сделать без сложной инфраструктуры: достаточно простого веб-приложения${s.isAI ? " и внешнего AI API" : ""}.`;
      strengths = ["Можно использовать готовые сервисы вместо собственной инфраструктуры", "MVP проверяет главную гипотезу без масштабирования"];
      weaknesses = s.isAI ? ["Зависимость от внешнего AI API: цены, лимиты, качество"] : ["Объём интеграций пока не ясен"];
      if (s.isAI) risks.push({ title: "Зависимость от внешнего AI-провайдера", severity: "medium", description: "Изменение цен или правил API напрямую влияет на продукт." });
      claims = [a(`MVP займёт порядка ${s.isHardware ? "2–3 месяцев" : "2–4 недель"} работы одного разработчика`, "estimate"), a("Для проверки гипотезы не нужны масштабирование и сложная архитектура")];
      recommendations = ["Сделать MVP на одном экране с ручной обработкой граничных случаев", "Не строить авторизацию, платежи и админку до подтверждения спроса"];
      break;
    case "product":
      summary = `Ключевая ценность «${t}» — решить одну конкретную задачу быстрее альтернатив; в первую версию стоит включить только эту функцию.`;
      strengths = ["Идею можно превратить в проверяемую гипотезу"];
      weaknesses = ["Пока не выделена одна главная функция", "Риск перегрузить первую версию"];
      claims = [a("Если продукт экономит пользователю заметное время на конкретной задаче, он будет возвращаться"), a("Остальные функции можно отложить без потери главной ценности")];
      recommendations = [
        `Гипотеза: «${s.hasAudience ? "Целевые пользователи" : "Пользователи"} готовы использовать продукт еженедельно, потому что он решает задачу быстрее текущего способа»`,
        "Исключить из MVP: настройки, интеграции, командную работу, мобильную версию",
      ];
      break;
    case "growth":
      summary = s.isContent
        ? `Для «${t}» органический рост через контент реален, но требует регулярности и времени.`
        : `Первых пользователей «${t}» можно найти без бюджета через тематические сообщества и личные контакты; масштабируемый канал пока не найден.`;
      strengths = ["Есть бесплатные каналы для первых 10–50 пользователей", ...(s.isContent ? ["Контент сам по себе становится каналом привлечения"] : [])];
      weaknesses = ["Нет проверенного масштабируемого канала", "Стоимость привлечения не измерена"];
      claims = [a("Тематические сообщества и форумы — самый дешёвый способ получить первых пользователей"), a("Платная реклама до подтверждения ценности, вероятно, окупаться не будет", "estimate")];
      recommendations = ["Сделать лендинг и привести на него 100–300 целевых посетителей из сообществ", "Измерить конверсию в заявку или лист ожидания"];
      break;
    case "risk":
      summary = s.isRegulated
        ? `У «${t}» есть регуляторные риски (персональные данные, отраслевые правила) — их нужно оценить до запуска.`
        : `Критических юридических рисков для «${t}» не видно; основные риски — зависимость от платформ и операционная нагрузка.`;
      if (s.isRegulated) risks.push({ title: "Регуляторные требования", severity: "critical", description: "Работа с чувствительными данными или регулируемой сферой может потребовать лицензий и соответствия законам." });
      if (s.isContent) risks.push({ title: "Правила платформ", severity: "medium", description: "Изменение алгоритмов или правил монетизации платформы может обнулить канал." });
      risks.push({ title: "Операционная нагрузка", severity: "low", description: "Поддержка пользователей может занять больше времени, чем разработка." });
      strengths = ["Риски можно снизить узким запуском и ручной модерацией"];
      weaknesses = ["Риски не оценены юридически", "Нет плана на случай отказа ключевого сервиса"];
      claims = [a("Для небольшого личного проекта часть рисков приемлема, если ограничить масштаб на старте")];
      recommendations = ["Проверить правила используемых платформ и API", ...(s.isRegulated ? ["Получить консультацию юриста до сбора данных пользователей"] : [])];
      break;
    case "independent":
      summary = `Агенты сходятся в главном: ценность «${t}» правдоподобна, но не подтверждена. Часть выводов опирается на предположения, а не на данные.`;
      strengths = ["Большинство выводов можно проверить дешёвыми экспериментами"];
      weaknesses = [
        "Оценки спроса у агентов опираются на предположения",
        s.richness < 0.4 ? "Описание идеи слишком краткое для уверенных выводов" : "Не учтён сценарий, при котором проблема решится без нового продукта",
      ];
      claims = [a("Расхождение между адвокатом и прокурором объясняется отсутствием данных, а не качеством идеи"), a("Альтернатива: продукт может быть полезен как внутренний инструмент автора, даже если рынок мал")];
      unknowns.push("Почему эту проблему ещё не решили другие");
      recommendations = ["Отделить проверяемые утверждения от предположений и проверить три главных"];
      break;
  }

  return {
    summary,
    stance: stanceOf(overallScore),
    overallScore,
    strengths,
    weaknesses,
    risks,
    claims,
    scorecard,
    confidence: s.richness > 0.6 ? "medium" : "low",
    unknowns: unknowns.slice(0, 6),
    recommendations,
    fullText:
      `${summary}\n\nДемонстрационное заключение: сгенерировано шаблоном без обращения к AI. ` +
      `Подключите реальную модель (AI_PROVIDER=anthropic), чтобы получить содержательный анализ роли «${agentName(id)}».`,
  };
}

function demoCrossExam(analyses: AgentAnalysis[]): CrossExamOutput {
  const done = new Map(analyses.filter((x) => x.status === "done").map((x) => [x.agentId, x]));
  const pairs: [AgentId, AgentId, string][] = [
    ["advocate", "prosecutor", "Есть ли у идеи реальный спрос"],
    ["tech", "finance", "Действительно ли запуск будет дешёвым"],
    ["growth", "market", "Хватит ли каналов привлечения для проверки спроса"],
    ["product", "independent", "Достаточно ли данных для выбора главной функции"],
  ];
  const issues: CrossExamOutput["issues"] = [];
  for (const [orig, counter, issue] of pairs) {
    const o = done.get(orig);
    const c = done.get(counter);
    if (!o || !c) continue;
    issues.push({
      issue,
      originalAgentId: orig,
      originalArgument: o.claims?.[0]?.statement ?? o.summary ?? "",
      counterAgentId: counter,
      counterArgument: c.weaknesses?.[0] ?? c.summary ?? "",
      resolution: "Обе позиции опираются на предположения. Спор решается не обсуждением, а дешёвым тестом спроса.",
      impact: issues.length === 0 ? "high" : "medium",
      resolved: false,
    });
  }
  return { issues: issues.slice(0, 4) };
}

const trimDot = (s?: string) => (s ?? "").replace(/[.\s]+$/, "");

function demoVerdict(input: Extract<AITaskInput, { task: "verdict" }>): VerdictOutput {
  const { analyses, aggregated, idea, crossExaminations } = input;
  const done = analyses.filter((x) => x.status === "done");
  const criteria = CRITERIA.map((c) => {
    const agg = aggregated.find((x) => x.criterion === c.key);
    const voters = done.filter((x) => x.scorecard?.some((s) => s.criterion === c.key));
    return {
      criterion: c.key,
      score: agg?.mean ?? 50,
      explanation:
        agg?.mean != null
          ? `Оценка опирается на заключения: ${voters.map((v) => agentName(v.agentId)).join(", ")}.${agg.spread >= 30 ? " Агенты заметно расходятся." : ""}`
          : "Ни один агент не оценил этот критерий.",
      keyArguments: voters.flatMap((v) => v.scorecard?.filter((s) => s.criterion === c.key).map((s) => s.comment) ?? []).slice(0, 2),
      confidence: (agg?.votes ?? 0) >= 3 ? ("medium" as const) : ("low" as const),
      missingData: agg?.mean == null || (agg.votes ?? 0) < 2 ? ["Недостаточно независимых оценок"] : [],
    };
  });
  const allRisks = done.flatMap((x) => x.risks ?? []);
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const topRisks = [...allRisks].sort((x, y) => order[x.severity] - order[y.severity]).filter((r, i, arr) => arr.findIndex((z) => z.title === r.title) === i).slice(0, 3);
  const overall = computeOverallScore(criteria);
  const decision = suggestDecision({ overallScore: overall, criteria, unresolvedCriticalRisks: countCriticalRisks(topRisks) });
  const pick = (id: AgentId) => done.find((x) => x.agentId === id);
  const pro = pick("advocate");
  const con = pick("prosecutor");

  return {
    decision,
    headline:
      decision === "approved"
        ? "Идея готова к проверке на MVP"
        : decision === "conditional"
          ? "Допуск при условии быстрой проверки спроса"
          : decision === "rework"
            ? "Сначала уточнить проблему и аудиторию"
            : "При текущих условиях дальнейшие усилия не оправданы",
    summary: `Демо-вердикт по делу «${idea.title}»: решение сформировано по правилам демо-режима из оценок агентов, без участия AI.`,
    reasoning:
      `Решающим стал вопрос спроса: ${con ? `обвинение указывает: «${trimDot(con.summary)}»` : "заключение обвинения отсутствует"}; ` +
      `${pro ? `защита отвечает: «${trimDot(pro.summary)}»` : "заключение защиты отсутствует"}. ` +
      "Аргументы обеих сторон в основном являются предположениями, поэтому судья опирается на критерии, где выводы агентов совпадают, " +
      "и не превращает единичную низкую оценку в отклонение.",
    weighedArguments: [
      ...(pro ? [{ side: "defense" as const, argument: pro.strengths?.[0] ?? pro.summary ?? "", agentId: "advocate", weight: "significant" as const, why: "Снижает цену ошибки и позволяет проверить идею дёшево." }] : []),
      ...(con ? [{ side: "prosecution" as const, argument: con.weaknesses?.[0] ?? con.summary ?? "", agentId: "prosecutor", weight: "decisive" as const, why: "Без подтверждения спроса остальные преимущества остаются гипотезами." }] : []),
    ],
    criteria,
    disagreements: crossExaminations.map((x) => `${x.issue}: ${agentName(x.originalAgentId)} против ${agentName(x.counterAgentId)}`),
    topRisks,
    unknowns: [...new Set(done.flatMap((x) => x.unknowns ?? []))].slice(0, 6),
    changes: ["Сузить аудиторию до одного сегмента", "Сформулировать одну главную функцию", "Определить, кто и за что платит"],
    validateBeforeBuild: ["Острота проблемы — 10 интервью", "Готовность платить — страница с ценой", "Доступность канала привлечения — 100+ целевых посетителей"],
    mvp: pick("tech")?.recommendations?.[0] ?? "Одностраничный прототип, решающий одну задачу, с ручной обработкой остального.",
    demandTestPlan: ["Описать ценностное предложение на лендинге", "Привести трафик из 2–3 тематических сообществ", "Собрать заявки или предзаказы в течение 2 недель", "Провести интервью с откликнувшимися"],
    successCriteria: ["Не менее 5% посетителей оставили заявку", "Не менее 3 человек готовы заплатить заранее"],
    failureCriteria: ["Менее 1% конверсии в заявку", "Интервью не подтверждают остроту проблемы"],
    nextStep: "Провести 10 интервью с потенциальными пользователями в ближайшие 7 дней.",
    conditionsForReview: ["Появились данные интервью или предзаказы", "Изменилась аудитория или модель монетизации"],
  };
}

export class DemoProvider implements AIProvider {
  readonly id = "demo" as const;
  readonly label = "Демо-режим (тестовые данные, без AI)";
  readonly paid = false;
  readonly model = null;

  constructor(private opts: { latencyMs: number; failAgent?: string } = { latencyMs: 0 }) {}

  async generate<T>(req: AIRequest<T>): Promise<T> {
    const input = req.input;
    if (this.opts.latencyMs > 0) {
      const seed = input.task === "agent" ? hash(input.agentId) : 1;
      await new Promise((r) => setTimeout(r, this.opts.latencyMs * (0.6 + (seed % 80) / 100)));
    }
    if (input.task === "agent" && this.opts.failAgent === input.agentId) {
      throw new AIError("server", "демо-сбой, заданный DEMO_FAIL_AGENT");
    }
    let out: unknown;
    if (input.task === "agent") out = demoAgent(input.agentId, input.idea, input.evidence, extractSignals(input.idea));
    else if (input.task === "cross_exam") out = demoCrossExam(input.analyses);
    else out = demoVerdict(input);
    return req.schema.parse(out);
  }
}

