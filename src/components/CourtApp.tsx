"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/client/api";
import { useCourt } from "@/client/useCourt";
import { AGENT_IDS, agentName, isAgentId } from "@/shared/agents";
import { planCourt, STAGE_LABEL } from "@/shared/courtPlan";
import { buildReport } from "@/shared/report";
import { DECISION_LABEL } from "@/shared/scoring";
import type { CaseSummary } from "@/shared/types";
import { AllConclusionsPanel } from "./AllConclusionsPanel";
import { CaseArchivePanel } from "./CaseArchivePanel";
import { useConfirm } from "./ConfirmDialog";
import { CourtProgress } from "./CourtProgress";
import { CourtScene } from "./CourtScene";
import { IdeaInput } from "./IdeaInput";
import { IdeaPrisonPanel } from "./IdeaPrisonPanel";
import { STATUS_TEXT } from "./labels";
import { ReopenDialog, type ReopenTarget } from "./ReopenDialog";
import { ReportPanel } from "./ReportPanel";
import { SettingsPanel, SetupNotice } from "./SettingsPanel";
import { VerdictPanel } from "./VerdictPanel";

type Panel = null | "archive" | "prison" | "settings" | "report" | "all";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CourtApp() {
  const { confirm, dialog } = useConfirm();
  const court = useCourt(confirm);
  const { bundle, settings, inflight, busy } = court;
  const [panel, setPanel] = useState<Panel>(null);
  const [verdictOpen, setVerdictOpen] = useState(true);
  const [reopenTarget, setReopenTarget] = useState<ReopenTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showIdea, setShowIdea] = useState(false);

  const plan = useMemo(() => (bundle && settings ? planCourt(bundle, settings.search.configured) : null), [bundle, settings]);
  const verdict = bundle?.verdict ?? null;

  useEffect(() => setVerdictOpen(true), [verdict?.id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const copyReport = async () => {
    if (!bundle) return;
    setToast((await copyText(buildReport(bundle))) ? "Отчёт скопирован в буфер обмена" : "Не удалось скопировать");
  };

  const openCase = async (id: string, then?: Panel) => {
    const b = await court.loadCase(id);
    setPanel(b ? then ?? null : null);
  };

  const askReopen = (c: { id: string; title: string; description?: string; conditions: string[]; fromPrison: boolean }) => {
    setPanel(null);
    setReopenTarget(c);
  };

  const reopenFromSummary = async (c: CaseSummary) => {
    const b = await api.getCase(c.id).catch(() => null);
    askReopen({ id: c.id, title: c.title, description: b?.case.description, conditions: c.conditionsForReview, fromPrison: c.status === "prison" });
  };

  const judgeCaption = (() => {
    if (!bundle) return "Суд готов рассмотреть вашу идею.";
    if (verdict) return `Решение: ${DECISION_LABEL[verdict.decision]}`;
    if (inflight.has("verdict")) return "Судья совещается…";
    if (inflight.has("cross")) return "Идёт перекрёстная критика…";
    if (inflight.has("evidence")) return "Сбор доказательств…";
    if (plan?.runningAgents.length || [...inflight].some(isAgentId)) return "Агенты изучают материалы дела…";
    return plan ? STAGE_LABEL[plan.stage] : "";
  })();

  const notConfigured = !!settings && !settings.configured;
  const doneCount = plan?.doneAgents.length ?? 0;
  const runningCount = bundle
    ? AGENT_IDS.filter((id) => inflight.has(id) || bundle.analyses.some((a) => a.agentId === id && a.status === "running")).length
    : 0;
  const canContinue = !!bundle && !verdict && !busy && !notConfigured;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>⚖</span>
          <h1 className="pixel-title">AI COURT</h1>
          <span className="case-no">{bundle ? `ДЕЛО №${bundle.case.number}${bundle.case.round > 1 ? ` · заседание ${bundle.case.round}` : ""}` : "НОВОЕ ДЕЛО"}</span>
        </div>
        <nav className="topnav" aria-label="Разделы">
          <button type="button" className="btn btn-small" onClick={court.newCase} disabled={busy}>+ Новое дело</button>
          <button type="button" className="btn btn-small" onClick={() => setPanel("archive")}>Архив</button>
          <button type="button" className="btn btn-small btn-prison" onClick={() => setPanel("prison")}>Тюрьма идей</button>
          <button type="button" className="icon-btn" onClick={() => setPanel("settings")} aria-label="Настройки">⚙</button>
        </nav>
      </header>

      {settings?.configError && settings.configured && <p className="banner banner-warn">{settings.configError}</p>}

      <main className="main">
        <CourtScene
          bundle={bundle}
          plan={plan}
          inflight={inflight}
          judgeCaption={judgeCaption}
          canRun={!!bundle && !verdict && !notConfigured}
          onRetryAgent={court.retryAgent}
          verdictSlot={
            verdict && verdictOpen && bundle ? (
              <VerdictPanel
                bundle={bundle}
                searchConfigured={!!settings?.search.configured}
                onClose={() => setVerdictOpen(false)}
                onOpenReport={() => setPanel("report")}
                onCopy={copyReport}
                onReopen={() =>
                  askReopen({ id: bundle.case.id, title: bundle.case.title, description: bundle.case.description, conditions: verdict.conditionsForReview, fromPrison: bundle.case.status === "prison" })
                }
              />
            ) : null
          }
        />

        <section className="dock pixel-box" aria-label="Подача и ход заседания">
          {notConfigured && <SetupNotice settings={settings} onOpenSettings={() => setPanel("settings")} />}
          {!bundle ? (
            <IdeaInput disabled={!settings || notConfigured} onSubmit={court.startCourt} />
          ) : (
            <div className="session">
              <div className="session-head">
                <div className="session-title">
                  <span className={`badge badge-${bundle.case.status}`}>{STATUS_TEXT[bundle.case.status]}</span>
                  <h2>{bundle.case.title}</h2>
                  <button type="button" className="link-btn" aria-expanded={showIdea} onClick={() => setShowIdea((s) => !s)}>
                    {showIdea ? "скрыть описание" : "описание"}
                  </button>
                </div>
                <CourtProgress plan={plan} />
              </div>
              {showIdea && <p className="session-desc">{bundle.case.description}</p>}

              <p className="session-status" aria-live="polite">
                Заключений: {doneCount}/9
                {runningCount > 0 && ` · анализируют: ${runningCount}`}
                {!!plan?.failedAgents.length && ` · ошибки: ${plan.failedAgents.map(agentName).join(", ")}`}
                {bundle.stages.crossExam === "done" && ` · критика: ${bundle.crossExaminations.length} вопр.`}
                {bundle.stages.crossExam === "error" && " · критика не удалась"}
                {bundle.stages.verdict === "error" && ` · судья: ${bundle.stages.verdictError}`}
                {!settings?.search.configured && " · без веб-поиска"}
              </p>
              {court.notice && <p className="notice notice-warn">{court.notice}</p>}

              <div className="session-actions">
                {canContinue && (
                  <button type="button" className="btn btn-primary" onClick={() => court.runSession(bundle.case.id)}>
                    {doneCount === 0 && !plan?.failedAgents.length ? "⚖ Начать заседание" : "▶ Продолжить заседание"}
                  </button>
                )}
                {canContinue && !!plan?.failedAgents.length && doneCount >= 3 && (
                  <button type="button" className="btn" onClick={() => court.runSession(bundle.case.id, { allowPartial: true })}>
                    Вердикт по имеющимся данным
                  </button>
                )}
                {busy && <span className="loading">Заседание идёт<span className="dots" aria-hidden /></span>}
                {verdict && !verdictOpen && (
                  <button type="button" className="btn btn-primary" onClick={() => setVerdictOpen(true)}>Показать вердикт</button>
                )}
                <button type="button" className="btn btn-small" onClick={() => setPanel("all")}>Все заключения</button>
                <button type="button" className="btn btn-small" onClick={() => setPanel("report")}>Отчёт и история</button>
                {verdict && <button type="button" className="btn btn-small" onClick={copyReport}>Копировать отчёт</button>}
              </div>
            </div>
          )}
          {court.error && (
            <p className="error-box" role="alert">
              {court.error}{" "}
              <button type="button" className="link-btn" onClick={() => court.setError(null)}>скрыть</button>
            </p>
          )}
        </section>
      </main>

      <CaseArchivePanel open={panel === "archive"} currentId={bundle?.case.id ?? null} onClose={() => setPanel(null)} onOpenCase={(id) => openCase(id)} />
      <IdeaPrisonPanel open={panel === "prison"} onClose={() => setPanel(null)} onOpenReport={(id) => openCase(id, "report")} onReopen={reopenFromSummary} />
      <SettingsPanel open={panel === "settings"} settings={settings} prefs={court.prefs} onChange={court.setPrefs} onClose={() => setPanel(null)} />
      <ReportPanel open={panel === "report"} bundle={bundle} onClose={() => setPanel(null)} onCopy={copyReport} />
      <AllConclusionsPanel open={panel === "all"} bundle={bundle} onClose={() => setPanel(null)} />
      <ReopenDialog
        target={reopenTarget}
        onClose={() => setReopenTarget(null)}
        onSubmit={async (grounds, description) => {
          await court.reopen(reopenTarget!.id, grounds, description);
          setReopenTarget(null);
          setToast("Открыто новое заседание. Нажмите «Начать заседание».");
        }}
      />
      {dialog}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
