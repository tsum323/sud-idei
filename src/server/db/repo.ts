import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  ActionPlan,
  AgentAnalysis,
  AgentId,
  CaseBundle,
  CaseEvent,
  CaseEventType,
  CaseStatus,
  CaseSummary,
  CrossExamination,
  Evidence,
  IdeaCase,
  StageState,
  Verdict,
} from "@/shared/types";
import type { AgentOutput, Decision, NewIdea } from "@/shared/schemas";
import { CaseNotFoundError, DECISION_TO_STATUS, type CourtStore } from "./store";

export { CaseNotFoundError, DECISION_TO_STATUS, type CourtStore };

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export class CourtRepo implements CourtStore {
  /** Через сколько миллисекунд «зависший» вызов считается прерванным. */
  constructor(
    private db: DatabaseSync,
    private staleMs = 10 * 60_000,
  ) {}

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ---------------------------- агенты (справочник) ---------------------------- */

  upsertAgents(agents: { id: string; name: string; role: string; systemPrompt: string; visualStyle: unknown }[]) {
    const stmt = this.db.prepare(
      `INSERT INTO agents (id, name, role, system_prompt, visual_style) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role,
       system_prompt = excluded.system_prompt, visual_style = excluded.visual_style`,
    );
    for (const a of agents) stmt.run(a.id, a.name, a.role, a.systemPrompt, JSON.stringify(a.visualStyle));
  }

  /* ---------------------------------- дела ---------------------------------- */

  createCase(idea: NewIdea): IdeaCase {
    return this.tx(() => {
      const id = randomUUID();
      const ts = now();
      const { n } = this.db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM cases").get() as { n: number };
      this.db
        .prepare(
          `INSERT INTO cases (id, number, title, description, optional_context, status, round, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
        )
        .run(id, n, idea.title, idea.description, JSON.stringify(idea.optionalContext ?? {}), ts, ts);
      this.ensureStages(id, 1);
      this.addEvent(id, 1, "created", `Дело №${n} заведено: «${idea.title}»`);
      return this.getCase(id);
    });
  }

  getCase(id: string): IdeaCase {
    const r = this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new CaseNotFoundError(id);
    return this.mapCase(r);
  }

  private mapCase(r: Row): IdeaCase {
    return {
      id: r.id as string,
      number: r.number as number,
      title: r.title as string,
      description: r.description as string,
      optionalContext: json(r.optional_context, {}),
      status: r.status as CaseStatus,
      round: r.round as number,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      lastReviewedAt: (r.last_reviewed_at as string) ?? null,
    };
  }

  private touch(caseId: string, status?: CaseStatus) {
    if (status) this.db.prepare("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), caseId);
    else this.db.prepare("UPDATE cases SET updated_at = ? WHERE id = ?").run(now(), caseId);
  }

  markInProgress(caseId: string) {
    const c = this.getCase(caseId);
    if (c.status === "draft") this.touch(caseId, "in_progress");
  }

  listCases(filter: { query?: string; status?: CaseStatus | "all" } = {}): CaseSummary[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status && filter.status !== "all") {
      where.push("c.status = ?");
      params.push(filter.status);
    }
    const rows = this.db
      .prepare(
        `SELECT c.*, v.decision, v.overall_score, v.risks, v.conditions_for_review, v.data AS vdata
         FROM cases c LEFT JOIN verdicts v ON v.case_id = c.id AND v.round = c.round
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY c.updated_at DESC`,
      )
      .all(...params) as Row[];
    const q = filter.query?.trim().toLowerCase();
    return rows
      .map((r) => {
        const c = this.mapCase(r);
        const risks = json<{ title: string }[]>(r.risks, []);
        const vdata = json<{ headline?: string }>(r.vdata, {});
        return {
          id: c.id,
          number: c.number,
          title: c.title,
          status: c.status,
          round: c.round,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          lastReviewedAt: c.lastReviewedAt,
          decision: (r.decision as Decision) ?? null,
          overallScore: (r.overall_score as number) ?? null,
          headline: vdata.headline ?? null,
          topRisk: risks[0]?.title ?? null,
          conditionsForReview: json<string[]>(r.conditions_for_review, []),
        } satisfies CaseSummary;
      })
      .filter((s) => !q || s.title.toLowerCase().includes(q) || String(s.number) === q.replace("№", ""));
  }

  /** Полное дело текущего заседания — читается из БД, без обращения к модели. */
  getBundle(caseId: string): CaseBundle {
    const c = this.getCase(caseId);
    const round = c.round;
    const verdicts = (this.db.prepare("SELECT * FROM verdicts WHERE case_id = ? ORDER BY round").all(caseId) as Row[]).map(
      (r) => this.mapVerdict(r),
    );
    const planRow = this.db.prepare("SELECT * FROM action_plans WHERE case_id = ? AND round = ?").get(caseId, round) as
      | Row
      | undefined;
    return {
      case: c,
      analyses: this.getAnalyses(caseId, round),
      evidence: this.getEvidence(caseId, round),
      crossExaminations: this.getCrossExaminations(caseId, round),
      verdict: verdicts.find((v) => v.round === round) ?? null,
      actionPlan: planRow
        ? {
            id: planRow.id as string,
            caseId,
            round,
            steps: json(planRow.steps, []),
            validationCriteria: json(planRow.validation_criteria, { success: [], failure: [] }),
            nextAction: planRow.next_action as string,
          }
        : null,
      events: (this.db.prepare("SELECT * FROM case_events WHERE case_id = ? ORDER BY created_at, rowid").all(caseId) as Row[]).map(
        (r) => ({
          id: r.id as string,
          caseId,
          round: r.round as number,
          eventType: r.event_type as CaseEventType,
          description: r.description as string,
          createdAt: r.created_at as string,
        }),
      ),
      stages: this.getStages(caseId, round),
      previousVerdicts: verdicts.filter((v) => v.round !== round),
    };
  }

  /* ----------------------------------- этапы ---------------------------------- */

  private ensureStages(caseId: string, round: number) {
    this.db
      .prepare("INSERT OR IGNORE INTO case_stages (case_id, round, updated_at) VALUES (?, ?, ?)")
      .run(caseId, round, now());
  }

  getStages(caseId: string, round: number): StageState {
    this.ensureStages(caseId, round);
    const r = this.db.prepare("SELECT * FROM case_stages WHERE case_id = ? AND round = ?").get(caseId, round) as Row;
    const stale = Date.now() - Date.parse(r.updated_at as string) > this.staleMs;
    const fix = (s: string) => (s === "running" && stale ? "error" : s);
    return {
      evidence: r.evidence as StageState["evidence"],
      crossExam: fix(r.cross_exam as string) as StageState["crossExam"],
      verdict: fix(r.verdict as string) as StageState["verdict"],
      crossExamError: r.cross_exam === "running" && stale ? "Этап прерван — можно повторить" : ((r.cross_exam_error as string) ?? null),
      verdictError: r.verdict === "running" && stale ? "Этап прерван — можно повторить" : ((r.verdict_error as string) ?? null),
    };
  }

  /**
   * Атомарно переводит этап в «running». Возвращает false, если этап уже идёт —
   * это защищает от двойного платного вызова при повторном нажатии.
   */
  tryStartStage(caseId: string, round: number, stage: "cross_exam" | "verdict"): boolean {
    this.ensureStages(caseId, round);
    const cutoff = new Date(Date.now() - this.staleMs).toISOString();
    const res = this.db
      .prepare(
        `UPDATE case_stages SET ${stage} = 'running', ${stage}_error = NULL, updated_at = ?
         WHERE case_id = ? AND round = ? AND (${stage} != 'running' OR updated_at < ?)`,
      )
      .run(now(), caseId, round, cutoff);
    return Number(res.changes) > 0;
  }

  setStage(caseId: string, round: number, stage: "evidence" | "cross_exam" | "verdict", status: string, error: string | null = null) {
    this.ensureStages(caseId, round);
    const errCol = stage === "evidence" ? "" : `, ${stage}_error = ?`;
    const params: (string | number | null)[] = [status, now()];
    if (errCol) params.push(error);
    params.push(caseId, round);
    this.db.prepare(`UPDATE case_stages SET ${stage} = ?, updated_at = ?${errCol} WHERE case_id = ? AND round = ?`).run(...params);
  }

  /* ---------------------------------- анализы --------------------------------- */

  getAnalyses(caseId: string, round: number): AgentAnalysis[] {
    const rows = this.db.prepare("SELECT * FROM agent_analyses WHERE case_id = ? AND round = ?").all(caseId, round) as Row[];
    return rows.map((r) => {
      const stale = r.status === "running" && Date.now() - Date.parse(r.updated_at as string) > this.staleMs;
      const data = r.status === "done" ? json<Partial<AgentOutput>>(r.data, {}) : {};
      return {
        ...data,
        id: r.id as string,
        caseId,
        round,
        agentId: r.agent_id as AgentId,
        status: stale ? "error" : (r.status as AgentAnalysis["status"]),
        error: stale ? "Вызов прерван (сервер перезапущен или превышено время ожидания)" : ((r.error as string) ?? null),
        attempts: r.attempts as number,
        provider: r.provider as string,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      };
    });
  }

  getAnalysis(caseId: string, round: number, agentId: AgentId): AgentAnalysis | undefined {
    return this.getAnalyses(caseId, round).find((a) => a.agentId === agentId);
  }

  /** Атомарно помечает агента как «Анализирует». false — анализ уже идёт. */
  tryStartAgent(caseId: string, round: number, agentId: AgentId, provider: string): boolean {
    const ts = now();
    const cutoff = new Date(Date.now() - this.staleMs).toISOString();
    return this.tx(() => {
      const existing = this.db
        .prepare("SELECT status, updated_at FROM agent_analyses WHERE case_id = ? AND round = ? AND agent_id = ?")
        .get(caseId, round, agentId) as Row | undefined;
      if (existing && existing.status === "running" && (existing.updated_at as string) >= cutoff) return false;
      if (existing) {
        // Предыдущий результат не удаляется до получения нового: data остаётся, пока не придёт успешный ответ.
        this.db
          .prepare(
            `UPDATE agent_analyses SET status = 'running', error = NULL, attempts = attempts + 1, provider = ?, updated_at = ?
             WHERE case_id = ? AND round = ? AND agent_id = ?`,
          )
          .run(provider, ts, caseId, round, agentId);
      } else {
        this.db
          .prepare(
            `INSERT INTO agent_analyses (id, case_id, round, agent_id, status, attempts, provider, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'running', 1, ?, ?, ?)`,
          )
          .run(randomUUID(), caseId, round, agentId, provider, ts, ts);
      }
      this.markInProgress(caseId);
      return true;
    });
  }

  saveAgentResult(caseId: string, round: number, agentId: AgentId, output: AgentOutput) {
    this.db
      .prepare(
        `UPDATE agent_analyses SET status = 'done', data = ?, error = NULL, updated_at = ?
         WHERE case_id = ? AND round = ? AND agent_id = ?`,
      )
      .run(JSON.stringify(output), now(), caseId, round, agentId);
    this.touch(caseId);
  }

  saveAgentError(caseId: string, round: number, agentId: AgentId, error: string) {
    this.db
      .prepare(
        `UPDATE agent_analyses SET status = 'error', error = ?, updated_at = ?
         WHERE case_id = ? AND round = ? AND agent_id = ?`,
      )
      .run(error, now(), caseId, round, agentId);
    this.touch(caseId);
  }

  /* -------------------------------- доказательства ------------------------------- */

  getEvidence(caseId: string, round: number): Evidence[] {
    return (this.db.prepare("SELECT * FROM evidence WHERE case_id = ? AND round = ? ORDER BY rowid").all(caseId, round) as Row[]).map(
      (r) => ({
        id: r.id as string,
        ref: r.ref as string,
        caseId,
        round,
        agentId: (r.agent_id as AgentId) ?? null,
        claim: r.claim as string,
        sourceUrl: r.source_url as string,
        sourceTitle: r.source_title as string,
        snippet: r.snippet as string,
        checkedAt: r.checked_at as string,
        evidenceType: r.evidence_type as Evidence["evidenceType"],
      }),
    );
  }

  saveEvidence(caseId: string, round: number, items: Omit<Evidence, "id" | "ref" | "caseId" | "round">[]) {
    this.tx(() => {
      this.db.prepare("DELETE FROM evidence WHERE case_id = ? AND round = ?").run(caseId, round);
      const stmt = this.db.prepare(
        `INSERT INTO evidence (id, ref, case_id, round, agent_id, claim, source_url, source_title, snippet, checked_at, evidence_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      items.forEach((e, i) =>
        stmt.run(randomUUID(), `E${i + 1}`, caseId, round, e.agentId, e.claim, e.sourceUrl, e.sourceTitle, e.snippet, e.checkedAt, e.evidenceType),
      );
    });
  }

  /* ----------------------------- перекрёстная критика ----------------------------- */

  getCrossExaminations(caseId: string, round: number): CrossExamination[] {
    return (
      this.db.prepare("SELECT * FROM cross_examinations WHERE case_id = ? AND round = ? ORDER BY rowid").all(caseId, round) as Row[]
    ).map((r) => ({
      id: r.id as string,
      caseId,
      round,
      issue: r.issue as string,
      originalAgentId: r.original_agent_id as string,
      originalArgument: r.original_argument as string,
      counterAgentId: r.counter_agent_id as string,
      counterArgument: r.counter_argument as string,
      resolution: r.resolution as string,
      impact: r.impact as CrossExamination["impact"],
      resolved: Boolean(r.resolved),
    }));
  }

  saveCrossExaminations(caseId: string, round: number, items: Omit<CrossExamination, "id" | "caseId" | "round">[]) {
    this.tx(() => {
      this.db.prepare("DELETE FROM cross_examinations WHERE case_id = ? AND round = ?").run(caseId, round);
      const stmt = this.db.prepare(
        `INSERT INTO cross_examinations (id, case_id, round, issue, original_agent_id, original_argument,
         counter_agent_id, counter_argument, resolution, impact, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const x of items) {
        stmt.run(
          randomUUID(), caseId, round, x.issue, x.originalAgentId, x.originalArgument,
          x.counterAgentId, x.counterArgument, x.resolution, x.impact, x.resolved ? 1 : 0,
        );
      }
      this.setStage(caseId, round, "cross_exam", "done");
    });
  }

  /* ----------------------------------- вердикт ----------------------------------- */

  private mapVerdict(r: Row): Verdict {
    const data = json<Omit<Verdict, "scores" | "risks" | "unknowns" | "conditionsForReview">>(r.data, {} as never);
    return {
      ...data,
      id: r.id as string,
      caseId: r.case_id as string,
      round: r.round as number,
      decision: r.decision as Decision,
      summary: r.summary as string,
      reasoning: r.reasoning as string,
      scores: json(r.scores, []),
      risks: json(r.risks, []),
      unknowns: json(r.unknowns, []),
      conditionsForReview: json(r.conditions_for_review, []),
      overallScore: r.overall_score as number,
      createdAt: r.created_at as string,
    };
  }

  /**
   * Сохраняет вердикт и план действий, обновляет статус дела.
   * Отклонённая идея получает статус «prison» — дело и все материалы сохраняются.
   */
  saveVerdict(verdict: Omit<Verdict, "id" | "createdAt">, plan: Omit<ActionPlan, "id">): Verdict {
    return this.tx(() => {
      const id = randomUUID();
      const ts = now();
      const { scores, risks, unknowns, conditionsForReview, decision, summary, reasoning, overallScore, caseId, round, ...rest } = verdict;
      this.db.prepare("DELETE FROM verdicts WHERE case_id = ? AND round = ?").run(caseId, round);
      this.db
        .prepare(
          `INSERT INTO verdicts (id, case_id, round, decision, summary, reasoning, scores, risks, unknowns,
           conditions_for_review, overall_score, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, caseId, round, decision, summary, reasoning, JSON.stringify(scores), JSON.stringify(risks),
          JSON.stringify(unknowns), JSON.stringify(conditionsForReview), overallScore, JSON.stringify(rest), ts,
        );
      this.db
        .prepare(
          `INSERT INTO action_plans (id, case_id, round, steps, validation_criteria, next_action) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(case_id, round) DO UPDATE SET steps = excluded.steps,
           validation_criteria = excluded.validation_criteria, next_action = excluded.next_action`,
        )
        .run(randomUUID(), caseId, round, JSON.stringify(plan.steps), JSON.stringify(plan.validationCriteria), plan.nextAction);
      const status = DECISION_TO_STATUS[decision];
      this.db.prepare("UPDATE cases SET status = ?, updated_at = ?, last_reviewed_at = ? WHERE id = ?").run(status, ts, ts, caseId);
      this.setStage(caseId, round, "verdict", "done");
      if (status === "prison") {
        this.addEvent(caseId, round, "imprisoned", "Идея отклонена и помещена в Тюрьму идей. Материалы дела сохранены.");
      }
      return this.mapVerdict(this.db.prepare("SELECT * FROM verdicts WHERE id = ?").get(id) as Row);
    });
  }

  /**
   * Возвращает дело на повторное рассмотрение: открывает новое заседание (round + 1).
   * Прошлые заключения и вердикты остаются в истории.
   */
  reopenCase(caseId: string, newGrounds: string, newDescription?: string): IdeaCase {
    return this.tx(() => {
      const c = this.getCase(caseId);
      if (c.status === "draft" || c.status === "in_progress") {
        throw new Error("Дело ещё не рассмотрено — пересматривать нечего");
      }
      const round = c.round + 1;
      const description = newDescription
        ? newDescription
        : c.description;
      const ctx = { ...c.optionalContext, comments: [c.optionalContext.comments, `Основания для пересмотра: ${newGrounds}`].filter(Boolean).join("\n") };
      this.db
        .prepare("UPDATE cases SET round = ?, status = 'in_progress', description = ?, optional_context = ?, updated_at = ? WHERE id = ?")
        .run(round, description, JSON.stringify(ctx), now(), caseId);
      this.ensureStages(caseId, round);
      this.addEvent(
        caseId,
        round,
        "reopened",
        `${c.status === "prison" ? "Идея возвращена из Тюрьмы идей" : "Дело возвращено"} на пересмотр (заседание ${round}). Основания: ${newGrounds}`,
      );
      return this.getCase(caseId);
    });
  }

  /* ----------------------------------- события ---------------------------------- */

  addEvent(caseId: string, round: number, type: CaseEventType, description: string): CaseEvent {
    const e: CaseEvent = { id: randomUUID(), caseId, round, eventType: type, description, createdAt: now() };
    this.db
      .prepare("INSERT INTO case_events (id, case_id, round, event_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.id, caseId, round, type, description, e.createdAt);
    return e;
  }
}
