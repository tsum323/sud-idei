import { AGENTS, agentName } from "./agents";
import { criterionLabel } from "./criteria";
import { OPTIONAL_CONTEXT_LABELS, type OptionalContext } from "./schemas";
import { CONFIDENCE_LABEL, DECISION_LABEL, SEVERITY_LABEL } from "./scoring";
import type { CaseBundle } from "./types";

const CLAIM_KIND_LABEL = { fact: "факт", assumption: "предположение", estimate: "оценка" } as const;

const bullets = (items: string[] | undefined, empty = "—") =>
  items && items.length ? items.map((i) => `- ${i}`).join("\n") : empty;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

/** Полный текстовый отчёт по делу (Markdown). Строится из сохранённых данных без вызова модели. */
export function buildReport(bundle: CaseBundle): string {
  const { case: c, verdict: v, analyses, crossExaminations, evidence, actionPlan } = bundle;
  const out: string[] = [];

  out.push(`# AI COURT — Дело №${c.number}: ${c.title}`);
  out.push(`Заседание: ${c.round}. Создано: ${formatDate(c.createdAt)}. Рассмотрено: ${formatDate(c.lastReviewedAt)}.`);

  out.push(`\n## 1. Идея\n${c.description}`);
  const ctx = Object.entries(c.optionalContext ?? {}).filter(([, val]) => val) as [keyof OptionalContext, string][];
  if (ctx.length) out.push(ctx.map(([k, val]) => `- **${OPTIONAL_CONTEXT_LABELS[k]}:** ${val}`).join("\n"));

  if (!v) {
    out.push("\n## Вердикт\nВердикт ещё не вынесен.");
  } else {
    out.push(`\n## 2. Итоговый вердикт\n**${DECISION_LABEL[v.decision]}** — ${v.headline}`);
    if (v.isPreliminary) {
      out.push(
        `> Предварительное решение: не получены заключения агентов — ${v.missingAgents.map(agentName).join(", ")}.`,
      );
    }
    out.push(v.summary);
    out.push(`\n**Обоснование судьи.** ${v.reasoning}`);

    out.push(
      `\n## 3. Общая оценка качества идеи\n${v.overallScore}/100 — ориентировочная оценка модели, не статистическая вероятность успеха.`,
    );

    out.push("\n## 4. Оценки по критериям");
    for (const s of v.scores) {
      out.push(
        `- **${criterionLabel(s.criterion)}: ${s.score}/100** (уверенность: ${CONFIDENCE_LABEL[s.confidence]}). ${s.explanation}` +
          (s.keyArguments.length ? `\n  - Аргументы: ${s.keyArguments.join("; ")}` : "") +
          (s.missingData.length ? `\n  - Не хватает данных: ${s.missingData.join("; ")}` : ""),
      );
    }

    const defense = v.weighedArguments.filter((w) => w.side === "defense");
    const prosecution = v.weighedArguments.filter((w) => w.side === "prosecution");
    const fmtArg = (w: (typeof defense)[number]) => `- ${w.argument} — ${agentName(w.agentId)} [вес: ${w.weight}]. ${w.why}`;
    out.push(`\n## 5. Сильнейшие аргументы защиты\n${defense.map(fmtArg).join("\n") || "—"}`);
    out.push(`\n## 6. Сильнейшие аргументы обвинения\n${prosecution.map(fmtArg).join("\n") || "—"}`);
  }

  out.push("\n## 7. Заключения агентов");
  for (const meta of AGENTS) {
    const a = analyses.find((x) => x.agentId === meta.id);
    if (!a || a.status !== "done") {
      out.push(`\n### ${meta.name}\n_Заключение отсутствует (${a?.status === "error" ? `ошибка: ${a.error}` : "не выполнено"})._`);
      continue;
    }
    out.push(`\n### ${meta.name} — ${a.overallScore}/100, уверенность: ${CONFIDENCE_LABEL[a.confidence ?? "low"]}`);
    out.push(a.summary ?? "");
    if (a.strengths?.length) out.push(`**Сильные стороны:**\n${bullets(a.strengths)}`);
    if (a.weaknesses?.length) out.push(`**Слабые стороны:**\n${bullets(a.weaknesses)}`);
    if (a.claims?.length) {
      out.push(
        `**Утверждения:**\n${a.claims
          .map((cl) => `- [${CLAIM_KIND_LABEL[cl.kind]}] ${cl.statement}${cl.evidenceIds.length ? ` (${cl.evidenceIds.join(", ")})` : ""}`)
          .join("\n")}`,
      );
    }
    if (a.unknowns?.length) out.push(`**Неизвестно:**\n${bullets(a.unknowns)}`);
  }

  out.push("\n## 8. Основные разногласия");
  if (crossExaminations.length) {
    for (const x of crossExaminations) {
      out.push(
        `- **${x.issue}** (${x.resolved ? "разрешено" : "не разрешено"}, влияние: ${x.impact})\n` +
          `  - ${agentName(x.originalAgentId)}: ${x.originalArgument}\n` +
          `  - ${agentName(x.counterAgentId)}: ${x.counterArgument}\n` +
          `  - Итог: ${x.resolution}`,
      );
    }
  }
  if (v?.disagreements.length) out.push(bullets(v.disagreements));
  if (!crossExaminations.length && !v?.disagreements.length) out.push("—");

  if (v) {
    out.push(
      `\n## 9. Три наиболее серьёзных риска\n${
        v.risks.map((r, i) => `${i + 1}. **${r.title}** (${SEVERITY_LABEL[r.severity]}) — ${r.description}`).join("\n") || "—"
      }`,
    );
    out.push(`\n## 10. Недостающая информация\n${bullets(v.unknowns)}`);
    out.push(`\n## 11. Что нужно изменить в идее\n${bullets(v.changes)}`);
    out.push(`\n## 12. Что проверить до разработки\n${bullets(v.validateBeforeBuild)}`);
    out.push(`\n## 13. Рекомендуемый MVP\n${v.mvp || "—"}`);
    out.push(`\n## 14. План проверки спроса\n${bullets(actionPlan?.steps ?? v.demandTestPlan)}`);
    out.push(
      `\n## 15. Критерии успеха и провала теста\n**Успех:**\n${bullets(v.successCriteria)}\n**Провал:**\n${bullets(v.failureCriteria)}`,
    );
    out.push(`\n## 16. Рекомендуемый следующий шаг\n${actionPlan?.nextAction ?? v.nextStep}`);
    out.push(`\n## 17. Условия пересмотра дела\n${bullets(v.conditionsForReview)}`);
  }

  out.push("\n## Источники");
  if (evidence.length) {
    out.push(
      evidence
        .map((e) => `- [${e.ref}] ${e.sourceTitle} — ${e.sourceUrl} (проверено: ${formatDate(e.checkedAt)})`)
        .join("\n"),
    );
  } else {
    out.push("Независимая проверка актуальных данных через веб-поиск не проводилась. Рыночные утверждения — оценки моделей.");
  }
  if (v) {
    out.push(
      `\n_Решение основано на заключениях: ${v.basedOnAgents.map(agentName).join(", ") || "—"}. Провайдер: ${v.provider}. ` +
        `Утверждений, пониженных с «факта» до «предположения» из-за отсутствия источника: ${v.downgradedClaims}._`,
    );
  }
  return out.join("\n");
}
