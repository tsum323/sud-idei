import { ApiError } from "@/client/apiError";
import { loadPrefs } from "@/client/prefs";
import { CourtError, CourtService } from "@/server/court/service";
import { CaseNotFoundError } from "@/server/db/store";
import type { NewIdeaInput } from "@/shared/schemas";
import type { AgentAnalysis, AgentId, AppSettings, CaseBundle, CaseStatus, CaseSummary } from "@/shared/types";
import { MemoryStore, type CaseDoc, type ChangeTarget, type RoundRecord } from "./memoryStore";
import { runtime, type ArtifactDb } from "./runtime";
import { SampleProvider } from "./sampleProvider";

export { ApiError };

interface Ctx {
  service: CourtService;
  store: MemoryStore;
  db: ArtifactDb | null;
  configured: boolean;
  configError: string | null;
}

/** Сохранение в хранилище артефакта: не больше одной записи на документ одновременно. */
class Persister {
  private queue = new Map<string, { running: boolean; again: boolean }>();
  error: string | null = null;

  constructor(
    private db: ArtifactDb,
    private store: MemoryStore,
  ) {}

  schedule(t: ChangeTarget) {
    const path = t.round == null ? `cases/${t.caseId}` : `cases/${t.caseId}/rounds/${t.round}`;
    const q = this.queue.get(path) ?? { running: false, again: false };
    this.queue.set(path, q);
    if (q.running) {
      q.again = true;
      return;
    }
    q.running = true;
    // Несколько изменений подряд сливаются в одну запись.
    setTimeout(() => void this.flush(path, t, q), 60);
  }

  private async flush(path: string, t: ChangeTarget, q: { running: boolean; again: boolean }) {
    do {
      q.again = false;
      const body = t.round == null ? this.store.exportCase(t.caseId) : this.store.exportRound(t.caseId, t.round);
      try {
        await this.db.doc(path).set(body as unknown as Record<string, unknown>);
        this.error = null;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        this.error =
          code === "quota_exceeded"
            ? "Хранилище страницы заполнено — удалите старые дела, чтобы сохранять новые."
            : "Не удалось сохранить изменения в хранилище claude.ai. Проверьте соединение.";
        console.error("AI COURT: ошибка сохранения", path, e);
      }
    } while (q.again);
    q.running = false;
  }
}

let ready: Promise<Ctx> | null = null;
const loadedRounds = new Set<string>();

async function init(): Promise<Ctx> {
  const rt = runtime();
  const [sample, db] = rt ? await Promise.all([rt.use("sample"), rt.use("db")]) : [null, null];
  let persister: Persister | null = null;
  const store = new MemoryStore(15 * 60_000, (t) => persister?.schedule(t));
  if (db) {
    persister = new Persister(db, store);
    const snap = await db.collection("cases").get();
    for (const d of snap.docs) if (d.exists) store.importCase(d.data() as unknown as CaseDoc);
  }
  const provider = sample ? new SampleProvider(sample, () => ({ economy: loadPrefs().economy })) : null;
  const service = new CourtService(store, { provider, search: null, retries: 1, timeoutMs: 600_000 });
  const problems = [
    !rt ? "Эта страница работает только внутри claude.ai." : null,
    rt && !sample ? "Claude недоступен на этой странице." : null,
    rt && !db ? "Хранилище claude.ai недоступно: дела не сохранятся после закрытия страницы." : null,
  ].filter(Boolean);
  return {
    service,
    store,
    db,
    configured: Boolean(provider),
    get configError() {
      return [...problems, persister?.error].filter(Boolean).join(" ") || null;
    },
  };
}

function ctx(): Promise<Ctx> {
  ready ??= init();
  return ready;
}

/** Подгружает заседания дела из хранилища (один раз за открытие страницы). */
async function ensureRounds(c: Ctx, caseId: string) {
  if (loadedRounds.has(caseId)) return;
  if (c.db) {
    const snap = await c.db.collection(`cases/${caseId}/rounds`).get();
    for (const d of snap.docs) if (d.exists) c.store.importRound(caseId, Number(d.id), d.data() as unknown as RoundRecord);
    c.store.interruptRunning(caseId);
  }
  loadedRounds.add(caseId);
}

async function call<T>(fn: (c: Ctx) => T | Promise<T>, caseId?: string): Promise<T> {
  const c = await ctx();
  try {
    if (caseId) await ensureRounds(c, caseId);
    return await fn(c);
  } catch (e) {
    if (e instanceof CourtError) throw new ApiError(e.status, e.message, e.details);
    if (e instanceof CaseNotFoundError) throw new ApiError(404, e.message);
    console.error(e);
    throw new ApiError(500, e instanceof Error ? e.message : "Непредвиденная ошибка");
  }
}

export const api = {
  settings: () =>
    call<AppSettings>((c) => ({
      provider: "claude-artifact",
      providerLabel: c.configured ? "Claude по вашей подписке (claude.ai)" : "Claude недоступен",
      billing: c.configured ? "subscription" : null,
      model: null,
      effort: null,
      paid: false,
      configured: c.configured,
      configError: c.configError,
      search: { provider: "none", configured: false },
      databasePath: "хранилище страницы на claude.ai",
      maxConcurrency: 2,
    })),
  listCases: (q = "", status: CaseStatus | "all" = "all") => call<CaseSummary[]>((c) => c.service.list({ query: q, status })),
  getCase: (id: string) => call<CaseBundle>((c) => c.service.bundle(id), id),
  createCase: (idea: NewIdeaInput) =>
    call<CaseBundle>((c) => {
      const created = c.service.createCase(idea);
      loadedRounds.add(created.id);
      return c.service.bundle(created.id);
    }),
  evidence: (id: string) =>
    call<CaseBundle>(async (c) => {
      await c.service.collectEvidence(id);
      return c.service.bundle(id);
    }, id),
  runAgent: (id: string, agentId: AgentId, force = false) => call<AgentAnalysis>((c) => c.service.runAgent(id, agentId, { force }), id),
  crossExam: (id: string, force = false) =>
    call<CaseBundle>(async (c) => {
      await c.service.runCrossExam(id, { force });
      return c.service.bundle(id);
    }, id),
  verdict: (id: string, allowPartial = false) =>
    call<CaseBundle>(async (c) => {
      await c.service.runVerdict(id, { allowPartial });
      return c.service.bundle(id);
    }, id),
  reopen: (id: string, newGrounds: string, description?: string) =>
    call<CaseBundle>((c) => {
      c.service.reopen(id, { newGrounds, description });
      return c.service.bundle(id);
    }, id),
};
