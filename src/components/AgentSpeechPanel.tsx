"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentMeta } from "@/shared/agents";
import { agentName } from "@/shared/agents";
import { criterionLabel } from "@/shared/criteria";
import { CONFIDENCE_LABEL, SEVERITY_LABEL } from "@/shared/scoring";
import type { AgentAnalysis, CrossExamination, Evidence } from "@/shared/types";
import { StatusChip } from "./Characters";

const STANCE_LABEL = { support: "за идею", neutral: "нейтрально", oppose: "против идеи" } as const;
const KIND_LABEL = { fact: "факт", assumption: "предположение", estimate: "оценка" } as const;

interface Props {
  meta: AgentMeta;
  analysis: AgentAnalysis | undefined;
  running: boolean;
  crossExaminations: CrossExamination[];
  evidence: Evidence[];
  canRun: boolean;
  isDemo: boolean;
  style?: React.CSSProperties;
  onClose: () => void;
  onRetry: () => void;
}

/** Панель заключения агента: сначала краткий вывод, подробности — по запросу. */
export function AgentSpeechPanel({ meta, analysis, running, crossExaminations, evidence, canRun, isDemo, style, onClose, onRetry }: Props) {
  const [details, setDetails] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const status = running ? "running" : (analysis?.status ?? "idle");
  const a = analysis;
  const related = crossExaminations.filter((x) => x.originalAgentId === meta.id || x.counterAgentId === meta.id);
  const evidenceByRef = new Map(evidence.map((e) => [e.ref, e]));

  useEffect(() => {
    setDetails(false);
    ref.current?.focus({ preventScroll: true });
    // На узком экране панель выводится под сценой — прокручиваем к ней.
    if (!style) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [meta.id]);

  return (
    <div
      id="speech-panel"
      ref={ref}
      className="speech-panel pixel-box"
      role="dialog"
      aria-label={`Заключение: ${meta.name}`}
      tabIndex={-1}
      style={{ ...style, "--accent": meta.visualStyle.accent } as React.CSSProperties}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <header className="speech-head">
        <div>
          <h3 className="pixel-title">{meta.name.toUpperCase()}</h3>
          <p className="speech-role">{meta.role}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть заключение">
          ✕
        </button>
      </header>

      <div className="speech-meta">
        <StatusChip status={status} />
        {a?.status === "done" && (
          <>
            <span className="tag">Оценка: {a.overallScore}/100</span>
            <span className={`tag stance-${a.stance}`}>{STANCE_LABEL[a.stance ?? "neutral"]}</span>
            <span className="tag">уверенность: {CONFIDENCE_LABEL[a.confidence ?? "low"]}</span>
            {isDemo && <span className="tag tag-demo">демо</span>}
          </>
        )}
      </div>

      {status === "idle" && <p className="muted">Агент ожидает начала заседания.</p>}
      {status === "running" && <p className="muted">Агент изучает материалы дела…</p>}
      {status === "error" && (
        <div className="error-box" role="alert">
          <p>{a?.error ?? "Ошибка анализа"}</p>
          <p className="muted small">Результаты остальных агентов сохранены. Можно повторить только этого агента.</p>
        </div>
      )}

      {a?.status === "done" && (
        <>
          <blockquote className="speech-summary">«{a.summary}»</blockquote>

          {!details && (
            <ul className="speech-short">
              {a.strengths?.[0] && <li className="plus">{a.strengths[0]}</li>}
              {a.weaknesses?.[0] && <li className="minus">{a.weaknesses[0]}</li>}
            </ul>
          )}

          <button type="button" className="link-btn" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            {details ? "Свернуть ▲" : "Подробнее ▼"}
          </button>

          {details && (
            <div className="speech-details">
              {!!a.strengths?.length && (
                <section>
                  <h4>Сильные стороны</h4>
                  <ul>{a.strengths.map((s, i) => <li key={i} className="plus">{s}</li>)}</ul>
                </section>
              )}
              {!!a.weaknesses?.length && (
                <section>
                  <h4>Слабые стороны</h4>
                  <ul>{a.weaknesses.map((s, i) => <li key={i} className="minus">{s}</li>)}</ul>
                </section>
              )}
              {!!a.risks?.length && (
                <section>
                  <h4>Риски</h4>
                  <ul>
                    {a.risks.map((r, i) => (
                      <li key={i} className={`risk risk-${r.severity}`}>
                        <b>{r.title}</b> <span className="tag">{SEVERITY_LABEL[r.severity]}</span> — {r.description}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!!a.claims?.length && (
                <section>
                  <h4>Аргументы</h4>
                  <ul>
                    {a.claims.map((c, i) => (
                      <li key={i}>
                        <span className={`tag kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span> {c.statement}
                        {c.evidenceIds.map((id) => {
                          const e = evidenceByRef.get(id);
                          return e ? (
                            <a key={id} className="evidence-ref" href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
                              [{id}]
                            </a>
                          ) : null;
                        })}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!!a.scorecard?.length && (
                <section>
                  <h4>Оценки по критериям</h4>
                  <ul className="mini-scores">
                    {a.scorecard.map((s) => (
                      <li key={s.criterion}>
                        <span>{criterionLabel(s.criterion)}</span>
                        <b>{s.score}</b>
                        <small>{s.comment}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!!a.unknowns?.length && (
                <section>
                  <h4>Чего не хватает</h4>
                  <ul>{a.unknowns.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </section>
              )}
              {!!a.recommendations?.length && (
                <section>
                  <h4>Рекомендации</h4>
                  <ul>{a.recommendations.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </section>
              )}
              {related.length > 0 && (
                <section>
                  <h4>Перекрёстная критика</h4>
                  {related.map((x) => (
                    <div key={x.id} className="cross-item">
                      <p><b>{x.issue}</b></p>
                      <p className="small">{agentName(x.originalAgentId)}: {x.originalArgument}</p>
                      <p className="small">{agentName(x.counterAgentId)}: {x.counterArgument}</p>
                      <p className="small muted">Итог: {x.resolution}</p>
                    </div>
                  ))}
                </section>
              )}
              {a.fullText && (
                <section>
                  <h4>Полное заключение</h4>
                  <p className="full-text">{a.fullText}</p>
                </section>
              )}
              {(a.downgraded ?? 0) > 0 && (
                <p className="small muted">
                  {a.downgraded} утвержд. помечены как предположения: модель назвала их фактами без ссылки на источник.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {canRun && status !== "running" && (status === "error" || status === "done") && (
        <div className="speech-actions">
          <button type="button" className="btn btn-small" onClick={onRetry}>
            {status === "error" ? "Повторить анализ" : "Перезапустить агента"}
          </button>
        </div>
      )}
    </div>
  );
}
