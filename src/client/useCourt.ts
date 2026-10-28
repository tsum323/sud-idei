"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentName } from "@/shared/agents";
import { estimateCalls, planCourt } from "@/shared/courtPlan";
import type { NewIdeaInput } from "@/shared/schemas";
import type { AgentId, AppSettings, CaseBundle } from "@/shared/types";
import { api, ApiError } from "./api";
import { DEFAULT_PREFS, loadPrefs, savePrefs, safeStorage, type Prefs } from "./prefs";

export type { Prefs };

const LAST_CASE_KEY = "ai-court:last-case";

export type ConfirmFn = (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;

/** Выполняет задачи с ограничением параллельности. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}

/**
 * Клиентская сторона заседания: запускает этапы по явному действию пользователя,
 * отображает прогресс и умеет продолжать прерванное дело. Модель вызывается только
 * из обработчиков кнопок — фоновых платных вызовов нет.
 */
export function useCourt(confirm: ConfirmFn) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [bundle, setBundle] = useState<CaseBundle | null>(null);
  const [inflight, setInflight] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const lock = useRef(false);

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  }, []);

  const mark = (key: string, on: boolean) =>
    setInflight((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const refresh = useCallback(async (id: string) => {
    const b = await api.getCase(id);
    setBundle(b);
    return b;
  }, []);

  const loadCase = useCallback(
    async (id: string, opts: { silent?: boolean } = {}) => {
      setError(null);
      setNotice(null);
      try {
        const b = await refresh(id);
        safeStorage(() => localStorage.setItem(LAST_CASE_KEY, id), undefined);
        return b;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) safeStorage(() => localStorage.removeItem(LAST_CASE_KEY), undefined);
        // Автоматическое восстановление прошлого дела не должно пугать ошибкой, если дела больше нет.
        if (!opts.silent) setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [refresh],
  );

  useEffect(() => {
    setPrefsState(loadPrefs());
    api.settings().then(setSettings).catch((e) => setError(e.message));
    const last = safeStorage(() => localStorage.getItem(LAST_CASE_KEY), null);
    if (last) void loadCase(last, { silent: true });
  }, [loadCase]);

  // Если дело открыто во время чужого/прерванного вызова — опрашиваем только хранилище (без вызова модели).
  const hasServerRunning =
    !!bundle &&
    (bundle.analyses.some((a) => a.status === "running") || bundle.stages.crossExam === "running" || bundle.stages.verdict === "running");
  useEffect(() => {
    if (!bundle || !hasServerRunning || inflight.size > 0) return;
    const t = setInterval(() => void refresh(bundle.case.id).catch(() => undefined), 3000);
    return () => clearInterval(t);
  }, [bundle, hasServerRunning, inflight.size, refresh]);

  /** Подтверждение перед вызовами модели: они тратят лимиты подписки или деньги на API. */
  const confirmPaid = useCallback(
    async (calls: number, what: string) => {
      if (!settings?.billing || !prefs.confirmPaid) return true;
      const cost =
        settings.billing === "subscription"
          ? "Запросы расходуют лимиты вашей подписки Claude."
          : "Вызовы Claude API оплачиваются по токенам.";
      return confirm({
        title: settings.billing === "subscription" ? "Запуск по подписке" : "Платный запуск",
        message: `${what}: около ${calls} запрос(ов) к модели ${settings.model}. ${cost} Продолжить?`,
        confirmLabel: "Запустить",
      });
    },
    [settings, prefs.confirmPaid, confirm],
  );

  /** Проводит оставшиеся этапы заседания. Уже завершённые этапы не повторяются. */
  const runSession = useCallback(
    async (caseId: string, opts: { allowPartial?: boolean; skipConfirm?: boolean } = {}) => {
      if (lock.current || !settings) return;
      lock.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        let b = await refresh(caseId);
        let plan = planCourt(b, settings.search.configured);
        if (plan.finished) return;
        if (!opts.skipConfirm && !(await confirmPaid(estimateCalls(plan), "Заседание"))) return;

        if (plan.needsEvidence) {
          mark("evidence", true);
          try {
            b = await api.evidence(caseId);
            setBundle(b);
          } finally {
            mark("evidence", false);
          }
        }

        const toRun = opts.allowPartial ? plan.pendingAgents.filter((id) => !plan.failedAgents.includes(id)) : plan.pendingAgents;
        await pool(toRun, Math.min(prefs.concurrency, settings.maxConcurrency ?? 9), async (agentId) => {
          mark(agentId, true);
          try {
            await api.runAgent(caseId, agentId);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            mark(agentId, false);
            await refresh(caseId).catch(() => undefined);
          }
        });

        b = await refresh(caseId);
        plan = planCourt(b, settings.search.configured);
        if (plan.failedAgents.length && !opts.allowPartial) {
          setNotice(
            `Не получены заключения: ${plan.failedAgents.map(agentName).join(", ")}. Повторите их анализ или продолжите с имеющимися данными — вердикт будет предварительным.`,
          );
          return;
        }

        if (b.stages.crossExam === "idle" && plan.canCrossExam) {
          mark("cross", true);
          try {
            b = await api.crossExam(caseId);
            setBundle(b);
          } finally {
            mark("cross", false);
          }
          plan = planCourt(b, settings.search.configured);
        }

        if (!b.verdict && plan.canVerdict) {
          mark("verdict", true);
          try {
            b = await api.verdict(caseId, plan.verdictWouldBePartial);
            setBundle(b);
          } finally {
            mark("verdict", false);
          }
        } else if (!b.verdict) {
          setNotice("Для вердикта нужны заключения хотя бы трёх агентов.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        await refresh(caseId).catch(() => undefined);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [settings, prefs.concurrency, refresh, confirmPaid],
  );

  const startCourt = useCallback(
    async (idea: NewIdeaInput): Promise<boolean> => {
      if (!settings) return false;
      if (!(await confirmPaid(11, "Новое заседание"))) return false;
      setError(null);
      try {
        const b = await api.createCase(idea);
        setBundle(b);
        safeStorage(() => localStorage.setItem(LAST_CASE_KEY, b.case.id), undefined);
        void runSession(b.case.id, { skipConfirm: true });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [settings, confirmPaid, runSession],
  );

  /** Повтор анализа одного агента. Повтор готового заключения требует подтверждения. */
  const retryAgent = useCallback(
    async (agentId: AgentId) => {
      if (!bundle) return;
      const current = bundle.analyses.find((a) => a.agentId === agentId);
      const force = current?.status === "done";
      if (force) {
        const ok = await confirm({
          title: "Повторный анализ",
          message: `Заключение агента «${agentName(agentId)}» уже получено. Заменить его новым? Это ещё один запрос к модели.`,
          confirmLabel: "Повторить",
        });
        if (!ok) return;
      } else if (!(await confirmPaid(1, `Повтор анализа «${agentName(agentId)}»`))) {
        return;
      }
      mark(agentId, true);
      setError(null);
      try {
        await api.runAgent(bundle.case.id, agentId, force);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        mark(agentId, false);
        await refresh(bundle.case.id).catch(() => undefined);
      }
    },
    [bundle, confirm, confirmPaid, refresh],
  );

  const reopen = useCallback(async (caseId: string, grounds: string, description?: string) => {
    const b = await api.reopen(caseId, grounds, description);
    setBundle(b);
    safeStorage(() => localStorage.setItem(LAST_CASE_KEY, caseId), undefined);
    return b;
  }, []);

  const newCase = useCallback(() => {
    if (lock.current) return;
    setBundle(null);
    setError(null);
    setNotice(null);
    safeStorage(() => localStorage.removeItem(LAST_CASE_KEY), undefined);
  }, []);

  return {
    settings,
    bundle,
    inflight,
    busy,
    error,
    notice,
    prefs,
    setPrefs,
    setError,
    loadCase,
    startCourt,
    runSession,
    retryAgent,
    reopen,
    newCase,
    refresh,
  };
}

export type Court = ReturnType<typeof useCourt>;
