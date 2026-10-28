"use client";

import { useEffect, useRef, useState } from "react";
import { agentName } from "@/shared/agents";
import { DECISION_LABEL, SEVERITY_LABEL } from "@/shared/scoring";
import type { CaseBundle } from "@/shared/types";
import { EvidenceList } from "./EvidenceList";
import { Scorecard } from "./Scorecard";

type Tab = "summary" | "scores" | "arguments" | "plan";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Решение" },
  { id: "scores", label: "Оценки" },
  { id: "arguments", label: "Аргументы" },
  { id: "plan", label: "План" },
];

interface Props {
  bundle: CaseBundle;
  searchConfigured: boolean;
  onClose: () => void;
  onOpenReport: () => void;
  onCopy: () => void;
  onReopen: () => void;
}

/** Оглашение вердикта: компактная панель внутри сцены. */
export function VerdictPanel({ bundle, searchConfigured, onClose, onOpenReport, onCopy, onReopen }: Props) {
  const v = bundle.verdict!;
  const [tab, setTab] = useState<Tab>("summary");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const defense = v.weighedArguments.filter((w) => w.side === "defense");
  const prosecution = v.weighedArguments.filter((w) => w.side === "prosecution");

  return (
    <div
      ref={ref}
      className={`verdict-panel pixel-box decision-${v.decision}`}
      role="dialog"
      aria-label="Итоговый вердикт"
      tabIndex={-1}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <header className="verdict-head">
        <div className="stamp">
          <span className="stamp-label">ВЕРДИКТ</span>
          <span className="stamp-decision">{DECISION_LABEL[v.decision]}</span>
        </div>
        <div className="verdict-score" title="Ориентировочная оценка модели, не вероятность успеха">
          <span className="pixel-num">{v.overallScore}</span>
          <span className="small">/100</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть вердикт">
          ✕
        </button>
      </header>
      <p className="verdict-headline">{v.headline}</p>
      {v.isPreliminary && (
        <p className="notice notice-warn">
          Предварительное решение: нет заключений — {v.missingAgents.map(agentName).join(", ")}.
        </p>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="verdict-body" role="tabpanel">
        {tab === "summary" && (
          <>
            <p>{v.summary}</p>
            <h4>Почему так</h4>
            <p>{v.reasoning}</p>
            <h4>Три главных риска</h4>
            <ol className="risk-list">
              {v.risks.map((r, i) => (
                <li key={i} className={`risk risk-${r.severity}`}>
                  <b>{r.title}</b> <span className="tag">{SEVERITY_LABEL[r.severity]}</span> — {r.description}
                </li>
              ))}
            </ol>
            <h4>Следующий шаг</h4>
            <p className="next-step">{v.nextStep}</p>
            <p className="muted small">
              Общий балл — ориентировочная оценка модели, а не статистическая вероятность успеха. Основано на заключениях:{" "}
              {v.basedOnAgents.length} из 9; источников: {v.evidenceUsed}.
            </p>
          </>
        )}
        {tab === "scores" && <Scorecard scores={v.scores} />}
        {tab === "arguments" && (
          <>
            <h4 className="good-text">Защита</h4>
            <ul>
              {defense.map((w, i) => (
                <li key={i}>
                  {w.argument} <span className="muted small">— {agentName(w.agentId)}, вес: {w.weight}. {w.why}</span>
                </li>
              ))}
            </ul>
            <h4 className="bad-text">Обвинение</h4>
            <ul>
              {prosecution.map((w, i) => (
                <li key={i}>
                  {w.argument} <span className="muted small">— {agentName(w.agentId)}, вес: {w.weight}. {w.why}</span>
                </li>
              ))}
            </ul>
            {bundle.crossExaminations.length > 0 && (
              <>
                <h4>Разногласия</h4>
                <ul>
                  {bundle.crossExaminations.map((x) => (
                    <li key={x.id}>
                      <b>{x.issue}.</b> {x.resolution}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>Источники</h4>
            <EvidenceList evidence={bundle.evidence} searchConfigured={searchConfigured} />
          </>
        )}
        {tab === "plan" && (
          <>
            <h4>Что изменить</h4>
            <ul>{v.changes.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <h4>Проверить до разработки</h4>
            <ul>{v.validateBeforeBuild.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <h4>Рекомендуемый MVP</h4>
            <p>{v.mvp}</p>
            <h4>План проверки спроса</h4>
            <ol>{v.demandTestPlan.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <div className="two-col">
              <div>
                <h4 className="good-text">Успех теста</h4>
                <ul>{v.successCriteria.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div>
                <h4 className="bad-text">Провал теста</h4>
                <ul>{v.failureCriteria.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            </div>
            <h4>Условия пересмотра</h4>
            <ul>{v.conditionsForReview.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </>
        )}
      </div>

      <footer className="verdict-actions">
        <button type="button" className="btn btn-small" onClick={onOpenReport}>
          Полный отчёт
        </button>
        <button type="button" className="btn btn-small" onClick={onCopy}>
          Копировать отчёт
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onReopen}>
          Пересмотреть
        </button>
      </footer>
    </div>
  );
}
