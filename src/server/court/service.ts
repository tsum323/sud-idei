import "server-only";
import { AGENT_IDS, AGENTS, agentName } from "@/shared/agents";
import { MIN_AGENTS_FOR_VERDICT } from "@/shared/courtPlan";
import { normalizeAgentOutput, normalizeCrossExam } from "@/shared/normalize";
import {
  AgentOutputSchema,
  CrossExamOutputSchema,
  NewIdeaSchema,
  ReopenSchema,
  type AgentOutput,
  type CrossExamOutput,
} from "@/shared/schemas";
import { DECISION_LABEL, findScoreConflicts } from "@/shared/scoring";
import type { AgentAnalysis, AgentId, CaseBundle, Evidence, IdeaCase } from "@/shared/types";
import { AIError, describeError } from "../ai/errors";
import { withRetry } from "../ai/retry";
import { systemPromptFor } from "../agents/roles";
import type { CourtRepo } from "../db/repo";
import { buildQueries } from "../evidence/search";
import { runJudge } from "../judge/judge";
import type { ServerConfig } from "../config";
import { agentPrompt, CROSS_EXAM_SYSTEM, crossExamPrompt } from "./prompts";

export class CourtError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new AIError("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export interface RunOptions {
  /** Повторный запуск уже завершённого этапа. Без этого флага готовый результат не пересчитывается. */
  force?: boolean;
}

/**
 * Логика судебного процесса. Каждый этап сохраняет результат сразу после
 * завершения, поэтому сбой одного вызова не уничтожает остальные результаты,
 * а прерванное заседание можно продолжить с места остановки.
 */
export class CourtService {
  constructor(
    private repo: CourtRepo,
    private cfg: ServerConfig,
  ) {
    repo.upsertAgents(
      AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, systemPrompt: systemPromptFor(a.id), visualStyle: a.visualStyle })),
    );
  }

  private call<T>(fn: () => Promise<T>): Promise<T> {
    // Запас на повторы: тайм-аут одного вызова уже задан в SDK, здесь — страховка для любого провайдера.
    return withRetry(() => withTimeout(fn(), this.cfg.timeoutMs + 5_000), { retries: this.cfg.retries });
  }

  createCase(input: unknown): IdeaCase {
    const parsed = NewIdeaSchema.safeParse(input);
    if (!parsed.success) {
      throw new CourtError(400, parsed.error.issues[0]?.message ?? "Неверные данные", parsed.error.issues);
    }
    return this.repo.createCase(parsed.data);
  }

  bundle(caseId: string): CaseBundle {
    return this.repo.getBundle(caseId);
  }

  list(filter: Parameters<CourtRepo["listCases"]>[0]) {
    return this.repo.listCases(filter);
  }

  /* --------------------------- этап 1a: доказательства --------------------------- */

  async collectEvidence(caseId: string, opts: RunOptions = {}): Promise<Evidence[]> {
    const c = this.repo.getCase(caseId);
    const stages = this.repo.getStages(caseId, c.round);
    if (!this.cfg.search) {
      if (stages.evidence === "idle") {
        this.repo.setStage(caseId, c.round, "evidence", "skipped");
        this.repo.addEvent(caseId, c.round, "evidence_skipped", "Веб-поиск не настроен: актуальные данные не проверялись");
      }
      return [];
    }
    if (stages.evidence === "done" && !opts.force) return this.repo.getEvidence(caseId, c.round);

    const checkedAt = new Date().toISOString();
    const seen = new Set<string>();
    const items: Omit<Evidence, "id" | "ref" | "caseId" | "round">[] = [];
    const errors: string[] = [];
    for (const q of buildQueries(c.title, c.optionalContext.audience)) {
      try {
        for (const r of await this.cfg.search.search(q.query, 3)) {
          if (seen.has(r.url) || items.length >= 8) continue;
          seen.add(r.url);
          items.push({ agentId: null, claim: q.claim, sourceUrl: r.url, sourceTitle: r.title, snippet: r.snippet, checkedAt, evidenceType: q.type });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    this.repo.saveEvidence(caseId, c.round, items);
    if (errors.length && items.length === 0) {
      this.repo.setStage(caseId, c.round, "evidence", "error");
      this.repo.addEvent(caseId, c.round, "evidence_skipped", `Поиск не удался: ${errors[0]}`);
    } else {
      this.repo.setStage(caseId, c.round, "evidence", "done");
      this.repo.addEvent(caseId, c.round, "evidence_collected", `Найдено источников: ${items.length}`);
    }
    return this.repo.getEvidence(caseId, c.round);
  }

  /* ---------------------------- этап 2: анализ агента ---------------------------- */

  async runAgent(caseId: string, agentId: AgentId, opts: RunOptions = {}): Promise<AgentAnalysis> {
    if (!AGENT_IDS.includes(agentId)) throw new CourtError(400, `Неизвестный агент: ${agentId}`);
    const c = this.repo.getCase(caseId);
    if (this.repo.getBundle(caseId).verdict) {
      throw new CourtError(409, "Вердикт уже вынесен. Чтобы пересмотреть дело, откройте повторное рассмотрение.");
    }
    const existing = this.repo.getAnalysis(caseId, c.round, agentId);
    if (existing?.status === "done" && !opts.force) return existing;
    if (!this.repo.tryStartAgent(caseId, c.round, agentId, this.cfg.provider.label)) {
      throw new CourtError(409, `${agentName(agentId)} уже анализирует дело`);
    }
    this.repo.addEvent(caseId, c.round, "agent_started", `${agentName(agentId)}: анализ начат`);

    const evidence = this.repo.getEvidence(caseId, c.round);
    try {
      const raw = await this.call(() =>
        this.cfg.provider.generate<AgentOutput>({
          input: { task: "agent", agentId, idea: c, evidence },
          system: systemPromptFor(agentId),
          prompt: agentPrompt(c, evidence),
          schema: AgentOutputSchema,
          maxTokens: 8000,
        }),
      );
      const output = normalizeAgentOutput(raw, new Set(evidence.map((e) => e.ref)));
      // «Готов» выставляется только здесь — после получения и сохранения результата.
      this.repo.saveAgentResult(caseId, c.round, agentId, output);
      this.repo.addEvent(caseId, c.round, "agent_done", `${agentName(agentId)}: заключение получено (${output.overallScore}/100)`);
    } catch (e) {
      const msg = describeError(e);
      this.repo.saveAgentError(caseId, c.round, agentId, msg);
      this.repo.addEvent(caseId, c.round, "agent_error", `${agentName(agentId)}: ${msg}`);
    }
    return this.repo.getAnalysis(caseId, c.round, agentId)!;
  }

  /* ------------------------- этап 3: перекрёстная критика ------------------------- */

  async runCrossExam(caseId: string, opts: RunOptions = {}) {
    const b = this.repo.getBundle(caseId);
    const { round } = b.case;
    if (b.verdict) throw new CourtError(409, "Вердикт уже вынесен");
    if (b.stages.crossExam === "done" && !opts.force) return b.crossExaminations;
    const done = b.analyses.filter((a) => a.status === "done");
    if (b.analyses.some((a) => a.status === "running")) throw new CourtError(409, "Дождитесь завершения анализа агентов");
    if (done.length < 2) throw new CourtError(409, "Для перекрёстной критики нужны заключения хотя бы двух агентов");
    if (!this.repo.tryStartStage(caseId, round, "cross_exam")) throw new CourtError(409, "Перекрёстная критика уже идёт");

    try {
      const raw = await this.call(() =>
        this.cfg.provider.generate<CrossExamOutput>({
          input: { task: "cross_exam", idea: b.case, analyses: done },
          system: CROSS_EXAM_SYSTEM,
          prompt: crossExamPrompt(b.case, done, findScoreConflicts(done)),
          schema: CrossExamOutputSchema,
          maxTokens: 8000,
        }),
      );
      const { issues } = normalizeCrossExam(raw, new Set(done.map((a) => a.agentId)));
      this.repo.saveCrossExaminations(caseId, round, issues);
      this.repo.addEvent(caseId, round, "cross_exam_done", `Перекрёстная критика: рассмотрено противоречий — ${issues.length}`);
    } catch (e) {
      const msg = describeError(e);
      this.repo.setStage(caseId, round, "cross_exam", "error", msg);
      this.repo.addEvent(caseId, round, "cross_exam_error", `Перекрёстная критика не удалась: ${msg}`);
    }
    return this.repo.getCrossExaminations(caseId, round);
  }

  /* ---------------------------- этапы 4–5: вердикт ---------------------------- */

  async runVerdict(caseId: string, opts: { allowPartial?: boolean } = {}) {
    const b = this.repo.getBundle(caseId);
    const { round } = b.case;
    // Повторное рассмотрение вынесенного дела — только через пересмотр (новое заседание).
    if (b.verdict) return b.verdict;
    const done = b.analyses.filter((a) => a.status === "done");
    const missing = AGENT_IDS.filter((id) => !done.some((a) => a.agentId === id));
    if (b.analyses.some((a) => a.status === "running")) throw new CourtError(409, "Дождитесь завершения анализа агентов");
    if (b.stages.crossExam === "running") throw new CourtError(409, "Дождитесь завершения перекрёстной критики");
    if (done.length < MIN_AGENTS_FOR_VERDICT) {
      throw new CourtError(409, `Для вердикта нужны заключения хотя бы ${MIN_AGENTS_FOR_VERDICT} агентов`);
    }
    if (missing.length && !opts.allowPartial) {
      throw new CourtError(409, "Не все агенты дали заключения. Повторите их анализ или подтвердите предварительный вердикт.", {
        missing,
      });
    }
    if (!this.repo.tryStartStage(caseId, round, "verdict")) throw new CourtError(409, "Судья уже совещается");

    try {
      const result = await runJudge(
        this.cfg.provider,
        {
          idea: b.case,
          analyses: done,
          crossExaminations: b.crossExaminations,
          crossExamFailed: b.stages.crossExam !== "done",
          evidence: b.evidence,
        },
        (fn) => this.call(fn),
      );
      const verdict = this.repo.saveVerdict(
        { ...result, caseId, round },
        {
          caseId,
          round,
          steps: result.demandTestPlan,
          validationCriteria: { success: result.successCriteria, failure: result.failureCriteria },
          nextAction: result.nextStep,
        },
      );
      this.repo.addEvent(
        caseId,
        round,
        "verdict_done",
        `Вердикт${verdict.isPreliminary ? " (предварительный)" : ""}: ${DECISION_LABEL[verdict.decision]}, ${verdict.overallScore}/100`,
      );
      return verdict;
    } catch (e) {
      const msg = describeError(e);
      this.repo.setStage(caseId, round, "verdict", "error", msg);
      this.repo.addEvent(caseId, round, "verdict_error", `Судья не смог вынести вердикт: ${msg}`);
      throw new CourtError(502, msg);
    }
  }

  /* ------------------------------ пересмотр дела ------------------------------ */

  reopen(caseId: string, input: unknown): IdeaCase {
    const parsed = ReopenSchema.safeParse(input);
    if (!parsed.success) throw new CourtError(400, parsed.error.issues[0]?.message ?? "Неверные данные");
    try {
      return this.repo.reopenCase(caseId, parsed.data.newGrounds, parsed.data.description);
    } catch (e) {
      throw new CourtError(409, e instanceof Error ? e.message : String(e));
    }
  }
}
