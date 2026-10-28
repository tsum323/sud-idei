import type { AgentOutput, Decision, NewIdea } from "@/shared/schemas";
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
import { CaseNotFoundError, DECISION_TO_STATUS, type CourtStore } from "@/server/db/store";

type StageName = "evidence" | "cross_exam" | "verdict";

interface StageRow {
  evidence: string;
  cross_exam: string;
  verdict: string;
  cross_exam_error: string | null;
  verdict_error: string | null;
  updatedAt: string;
}

interface AnalysisRow {
  id: string;
  status: string;
  data: AgentOutput | null;
  error: string | null;
  attempts: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

/** Всё об одном заседании — хранится одним документом. */
export interface RoundRecord {
  stages: StageRow;
  analyses: Partial<Record<AgentId, AnalysisRow>>;
  evidence: Evidence[];
  cross: CrossExamination[];
  verdict: Verdict | null;
  plan: ActionPlan | null;
  events: CaseEvent[];
}

/** Краткие сведения о текущем вердикте — для архива без загрузки заседаний. */
export interface CaseSummaryFields {
  decision: Decision | null;
  overallScore: number | null;
  headline: string | null;
  topRisk: string | null;
  conditionsForReview: string[];
}

/** Документ дела: само дело и сводка для списков. */
export interface CaseDoc {
  case: IdeaCase;
  summary: CaseSummaryFields;
}

interface CaseRecord extends CaseDoc {
  rounds: Map<number, RoundRecord>;
}

export type ChangeTarget = { caseId: string; round: number | null };

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const EMPTY_SUMMARY: CaseSummaryFields = { decision: null, overallScore: null, headline: null, topRisk: null, conditionsForReview: [] };

function emptyRound(): RoundRecord {
  return {
    stages: { evidence: "idle", cross_exam: "idle", verdict: "idle", cross_exam_error: null, verdict_error: null, updatedAt: now() },
    analyses: {},
    evidence: [],
    cross: [],
    verdict: null,
    plan: null,
    events: [],
  };
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Хранилище в памяти страницы с тем же поведением, что у CourtRepo (SQLite).
 * Каждое изменение сообщается через onChange: страница сохраняет затронутый
 * документ (дело или заседание) в хранилище артефакта.
 */
export class MemoryStore implements CourtStore {
  private cases = new Map<string, CaseRecord>();

  constructor(
    private staleMs = 15 * 60_000,
    private onChange: (t: ChangeTarget) => void = () => undefined,
  ) {}

  /* ------------------------- загрузка и выгрузка ------------------------- */

  importCase(doc: CaseDoc) {
    const prev = this.cases.get(doc.case.id);
    this.cases.set(doc.case.id, { case: clone(doc.case), summary: clone(doc.summary ?? EMPTY_SUMMARY), rounds: prev?.rounds ?? new Map() });
  }

  importRound(caseId: string, round: number, rec: RoundRecord) {
    this.rec(caseId).rounds.set(round, clone(rec));
  }

  /**
   * Запросы к Claude живут, только пока открыта страница. Всё, что после
   * загрузки числится «в работе», было прервано закрытием страницы.
   */
  interruptRunning(caseId: string) {
    for (const [round, rr] of this.rec(caseId).rounds) {
      let touched = false;
      for (const row of Object.values(rr.analyses)) {
        if (row?.status === "running") {
          Object.assign(row, { status: "error", error: "Запрос прерван: страница была закрыта. Повторите анализ." });
          touched = true;
        }
      }
      for (const stage of ["cross_exam", "verdict"] as const) {
        if (rr.stages[stage] === "running") {
          rr.stages[stage] = "error";
          rr.stages[`${stage}_error`] = "Этап прерван: страница была закрыта. Повторите.";
          touched = true;
        }
      }
      if (touched) this.changed(caseId, round);
    }
  }

  hasRound(caseId: string, round: number): boolean {
    return this.rec(caseId).rounds.has(round);
  }

  exportCase(caseId: string): CaseDoc {
    const r = this.rec(caseId);
    return clone({ case: r.case, summary: r.summary });
  }

  exportRound(caseId: string, round: number): RoundRecord {
    return clone(this.round(caseId, round));
  }

  caseIds(): string[] {
    return [...this.cases.keys()];
  }

  /* ------------------------------- служебное ------------------------------- */

  private rec(id: string): CaseRecord {
    const r = this.cases.get(id);
    if (!r) throw new CaseNotFoundError(id);
    return r;
  }

  private round(caseId: string, round: number): RoundRecord {
    const r = this.rec(caseId);
    let rr = r.rounds.get(round);
    if (!rr) {
      rr = emptyRound();
      r.rounds.set(round, rr);
    }
    return rr;
  }

  private changed(caseId: string, round: number | null) {
    this.onChange({ caseId, round });
  }

  private touch(caseId: string, status?: CaseStatus) {
    const c = this.rec(caseId).case;
    if (status) c.status = status;
    c.updatedAt = now();
    this.changed(caseId, null);
  }

  private stale(updatedAt: string) {
    return Date.now() - Date.parse(updatedAt) > this.staleMs;
  }

  upsertAgents() {
    /* справочник агентов в странице не хранится — он задан в коде */
  }

  /* ---------------------------------- дела ---------------------------------- */

  createCase(idea: NewIdea): IdeaCase {
    const ts = now();
    const number = Math.max(0, ...[...this.cases.values()].map((r) => r.case.number)) + 1;
    const c: IdeaCase = {
      id: uid(),
      number,
      title: idea.title,
      description: idea.description,
      optionalContext: idea.optionalContext ?? {},
      status: "draft",
      round: 1,
      createdAt: ts,
      updatedAt: ts,
      lastReviewedAt: null,
    };
    this.cases.set(c.id, { case: c, summary: { ...EMPTY_SUMMARY }, rounds: new Map([[1, emptyRound()]]) });
    this.addEvent(c.id, 1, "created", `Дело №${number} заведено: «${idea.title}»`);
    this.changed(c.id, null);
    return clone(c);
  }

  getCase(id: string): IdeaCase {
    return clone(this.rec(id).case);
  }

  listCases(filter: { query?: string; status?: CaseStatus | "all" } = {}): CaseSummary[] {
    const q = filter.query?.trim().toLowerCase();
    return [...this.cases.values()]
      .filter((r) => !filter.status || filter.status === "all" || r.case.status === filter.status)
      .map((r) => ({
        id: r.case.id,
        number: r.case.number,
        title: r.case.title,
        status: r.case.status,
        round: r.case.round,
        createdAt: r.case.createdAt,
        updatedAt: r.case.updatedAt,
        lastReviewedAt: r.case.lastReviewedAt,
        ...clone(r.summary),
      }))
      .filter((s) => !q || s.title.toLowerCase().includes(q) || String(s.number) === q.replace("№", ""))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getBundle(caseId: string): CaseBundle {
    const r = this.rec(caseId);
    const round = r.case.round;
    const cur = this.round(caseId, round);
    const rounds = [...r.rounds.entries()].sort((a, b) => a[0] - b[0]);
    return {
      case: clone(r.case),
      analyses: this.getAnalyses(caseId, round),
      evidence: clone(cur.evidence),
      crossExaminations: clone(cur.cross),
      verdict: clone(cur.verdict),
      actionPlan: clone(cur.plan),
      events: rounds.flatMap(([, rr]) => clone(rr.events)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      stages: this.getStages(caseId, round),
      previousVerdicts: rounds.filter(([n, rr]) => n !== round && rr.verdict).map(([, rr]) => clone(rr.verdict!)),
    };
  }

  /* ---------------------------------- этапы --------------------------------- */

  getStages(caseId: string, round: number): StageState {
    const s = this.round(caseId, round).stages;
    const stale = this.stale(s.updatedAt);
    const fix = (v: string) => (v === "running" && stale ? "error" : v);
    return {
      evidence: s.evidence as StageState["evidence"],
      crossExam: fix(s.cross_exam) as StageState["crossExam"],
      verdict: fix(s.verdict) as StageState["verdict"],
      crossExamError: s.cross_exam === "running" && stale ? "Этап прерван — можно повторить" : s.cross_exam_error,
      verdictError: s.verdict === "running" && stale ? "Этап прерван — можно повторить" : s.verdict_error,
    };
  }

  tryStartStage(caseId: string, round: number, stage: "cross_exam" | "verdict"): boolean {
    const s = this.round(caseId, round).stages;
    if (s[stage] === "running" && !this.stale(s.updatedAt)) return false;
    s[stage] = "running";
    s[`${stage}_error`] = null;
    s.updatedAt = now();
    this.changed(caseId, round);
    return true;
  }

  setStage(caseId: string, round: number, stage: StageName, status: string, error: string | null = null) {
    const s = this.round(caseId, round).stages;
    s[stage] = status;
    if (stage !== "evidence") s[`${stage}_error`] = error;
    s.updatedAt = now();
    this.changed(caseId, round);
  }

  /* --------------------------------- анализы -------------------------------- */

  getAnalyses(caseId: string, round: number): AgentAnalysis[] {
    const rr = this.round(caseId, round);
    return (Object.entries(rr.analyses) as [AgentId, AnalysisRow][]).map(([agentId, row]) => {
      const stale = row.status === "running" && this.stale(row.updatedAt);
      const data = row.status === "done" && row.data ? clone(row.data) : {};
      return {
        ...data,
        id: row.id,
        caseId,
        round,
        agentId,
        status: stale ? "error" : (row.status as AgentAnalysis["status"]),
        error: stale ? "Запрос прерван (страница была закрыта или превышено время ожидания)" : row.error,
        attempts: row.attempts,
        provider: row.provider,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  getAnalysis(caseId: string, round: number, agentId: AgentId) {
    return this.getAnalyses(caseId, round).find((a) => a.agentId === agentId);
  }

  tryStartAgent(caseId: string, round: number, agentId: AgentId, provider: string): boolean {
    const rr = this.round(caseId, round);
    const ts = now();
    const row = rr.analyses[agentId];
    if (row && row.status === "running" && !this.stale(row.updatedAt)) return false;
    if (row) {
      // прежний результат остаётся, пока не придёт новый
      Object.assign(row, { status: "running", error: null, attempts: row.attempts + 1, provider, updatedAt: ts });
    } else {
      rr.analyses[agentId] = { id: uid(), status: "running", data: null, error: null, attempts: 1, provider, createdAt: ts, updatedAt: ts };
    }
    const c = this.rec(caseId).case;
    if (c.status === "draft") this.touch(caseId, "in_progress");
    this.changed(caseId, round);
    return true;
  }

  saveAgentResult(caseId: string, round: number, agentId: AgentId, output: AgentOutput) {
    const row = this.round(caseId, round).analyses[agentId];
    if (!row) return;
    Object.assign(row, { status: "done", data: clone(output), error: null, updatedAt: now() });
    this.changed(caseId, round);
    this.touch(caseId);
  }

  saveAgentError(caseId: string, round: number, agentId: AgentId, error: string) {
    const row = this.round(caseId, round).analyses[agentId];
    if (!row) return;
    Object.assign(row, { status: "error", error, updatedAt: now() });
    this.changed(caseId, round);
    this.touch(caseId);
  }

  /* ------------------------------ доказательства ----------------------------- */

  getEvidence(caseId: string, round: number): Evidence[] {
    return clone(this.round(caseId, round).evidence);
  }

  saveEvidence(caseId: string, round: number, items: Omit<Evidence, "id" | "ref" | "caseId" | "round">[]) {
    this.round(caseId, round).evidence = items.map((e, i) => ({ ...clone(e), id: uid(), ref: `E${i + 1}`, caseId, round }));
    this.changed(caseId, round);
  }

  /* --------------------------- перекрёстная критика -------------------------- */

  getCrossExaminations(caseId: string, round: number): CrossExamination[] {
    return clone(this.round(caseId, round).cross);
  }

  saveCrossExaminations(caseId: string, round: number, items: Omit<CrossExamination, "id" | "caseId" | "round">[]) {
    this.round(caseId, round).cross = items.map((x) => ({ ...clone(x), id: uid(), caseId, round }));
    this.setStage(caseId, round, "cross_exam", "done");
  }

  /* --------------------------------- вердикт --------------------------------- */

  saveVerdict(verdict: Omit<Verdict, "id" | "createdAt">, plan: Omit<ActionPlan, "id">): Verdict {
    const { caseId, round } = verdict;
    const rr = this.round(caseId, round);
    const ts = now();
    const saved: Verdict = { ...clone(verdict), id: uid(), createdAt: ts };
    rr.verdict = saved;
    rr.plan = { ...clone(plan), id: rr.plan?.id ?? uid() };
    const r = this.rec(caseId);
    const status = DECISION_TO_STATUS[saved.decision];
    Object.assign(r.case, { status, updatedAt: ts, lastReviewedAt: ts });
    r.summary = {
      decision: saved.decision,
      overallScore: saved.overallScore,
      headline: saved.headline ?? null,
      topRisk: saved.risks[0]?.title ?? null,
      conditionsForReview: clone(saved.conditionsForReview),
    };
    this.setStage(caseId, round, "verdict", "done");
    if (status === "prison") {
      this.addEvent(caseId, round, "imprisoned", "Идея отклонена и помещена в Тюрьму идей. Материалы дела сохранены.");
    }
    this.changed(caseId, null);
    return clone(saved);
  }

  reopenCase(caseId: string, newGrounds: string, newDescription?: string): IdeaCase {
    const r = this.rec(caseId);
    const c = r.case;
    if (c.status === "draft" || c.status === "in_progress") throw new Error("Дело ещё не рассмотрено — пересматривать нечего");
    const prevStatus = c.status;
    const round = c.round + 1;
    c.round = round;
    c.status = "in_progress";
    if (newDescription) c.description = newDescription;
    c.optionalContext = {
      ...c.optionalContext,
      comments: [c.optionalContext.comments, `Основания для пересмотра: ${newGrounds}`].filter(Boolean).join("\n"),
    };
    c.updatedAt = now();
    r.summary = { ...EMPTY_SUMMARY };
    r.rounds.set(round, emptyRound());
    this.addEvent(
      caseId,
      round,
      "reopened",
      `${prevStatus === "prison" ? "Идея возвращена из Тюрьмы идей" : "Дело возвращено"} на пересмотр (заседание ${round}). Основания: ${newGrounds}`,
    );
    this.changed(caseId, null);
    return clone(c);
  }

  /* --------------------------------- события --------------------------------- */

  addEvent(caseId: string, round: number, type: CaseEventType, description: string): CaseEvent {
    const e: CaseEvent = { id: uid(), caseId, round, eventType: type, description, createdAt: now() };
    this.round(caseId, round).events.push(e);
    this.changed(caseId, round);
    return clone(e);
  }
}
