import { openDatabase } from "@/server/db/db";
import { CourtRepo } from "@/server/db/repo";
import type { CourtStore } from "@/server/db/store";
import { MemoryStore } from "@/artifact/memoryStore";
import { CourtService } from "@/server/court/service";
import { FakeProvider } from "./fixtures/fakeProvider";
import { AIError } from "@/server/ai/errors";
import type { AIProvider, AIRequest } from "@/server/ai/types";
import type { ServerConfig } from "@/server/config";
import type { SearchProvider } from "@/server/evidence/search";
import { AGENT_IDS } from "@/shared/agents";

export const IDEA = {
  title: "Планировщик питания с ИИ",
  description:
    "Веб-приложение, которое по списку продуктов в холодильнике составляет меню на неделю и список покупок. Для занятых родителей, которые тратят много времени на планирование.",
  optionalContext: { audience: "Работающие родители с детьми", monetization: "Подписка 299 ₽ в месяц" },
};

/** Провайдер-обёртка: считает вызовы и позволяет «ронять» выбранные задачи. */
export class SpyProvider implements AIProvider {
  readonly id = "fake";
  readonly label = "spy";
  readonly paid = false;
  readonly model = null;
  calls: string[] = [];
  failures = new Map<string, AIError[]>();
  private inner = new FakeProvider({ latencyMs: 0 });

  failNext(key: string, ...errors: AIError[]) {
    this.failures.set(key, errors);
  }

  async generate<T>(req: AIRequest<T>): Promise<T> {
    const key = req.input.task === "agent" ? `agent:${req.input.agentId}` : req.input.task;
    this.calls.push(key);
    const queue = this.failures.get(key);
    if (queue && queue.length) throw queue.shift()!;
    return this.inner.generate(req);
  }
}

export function makeService(opts: { provider?: AIProvider | null; search?: SearchProvider | null; retries?: number; staleMs?: number; timeoutMs?: number } = {}) {
  // COURT_STORE=memory прогоняет те же тесты на хранилище страницы-артефакта.
  const repo: CourtStore =
    process.env.COURT_STORE === "memory"
      ? new MemoryStore(opts.staleMs ?? 60_000)
      : new CourtRepo(openDatabase(":memory:"), opts.staleMs ?? 60_000);
  const provider = opts.provider === undefined ? new SpyProvider() : opts.provider;
  const cfg: ServerConfig = {
    kind: "claude-code",
    provider,
    search: opts.search ?? null,
    retries: opts.retries ?? 0,
    timeoutMs: opts.timeoutMs ?? 5_000,
    configError: null,
  };
  return { repo, service: new CourtService(repo, cfg), provider };
}

export async function runFullCourt(service: CourtService, caseId: string) {
  await service.collectEvidence(caseId);
  await Promise.all(AGENT_IDS.map((id) => service.runAgent(caseId, id)));
  await service.runCrossExam(caseId);
  return service.runVerdict(caseId, { allowPartial: true });
}
