import { describe, expect, it } from "vitest";
import { AIError } from "@/server/ai/errors";
import type { AIProvider, AIRequest } from "@/server/ai/types";
import { FakeProvider } from "./fixtures/fakeProvider";
import type { SearchProvider } from "@/server/evidence/search";
import { AGENT_IDS } from "@/shared/agents";
import { planCourt } from "@/shared/courtPlan";
import { buildReport } from "@/shared/report";
import { computeOverallScore } from "@/shared/scoring";
import { IDEA, makeService, runFullCourt, SpyProvider } from "./helpers";

describe("создание дела", () => {
  it("создаёт дело с последовательным номером и событием в истории", () => {
    const { service } = makeService();
    const a = service.createCase(IDEA);
    const b = service.createCase({ ...IDEA, title: "Вторая идея" });
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(a.status).toBe("draft");
    expect(service.bundle(a.id).events.map((e) => e.eventType)).toEqual(["created"]);
  });

  it("отклоняет неверный ввод с понятной ошибкой", () => {
    const { service } = makeService();
    expect(() => service.createCase({ title: "", description: "" })).toThrow(/Название/);
  });
});

describe("анализ агентов", () => {
  it("сохраняет результат агента и помечает «Готов» только после получения результата", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = new FakeProvider({ latencyMs: 0 });
    const slow: AIProvider = {
      id: "fake", label: "slow", paid: false, model: null,
      async generate<T>(req: AIRequest<T>) {
        await gate;
        return inner.generate(req);
      },
    };
    const { service } = makeService({ provider: slow });
    const c = service.createCase(IDEA);
    const pending = service.runAgent(c.id, "market");
    await new Promise((r) => setTimeout(r, 10));
    const during = service.bundle(c.id).analyses.find((a) => a.agentId === "market")!;
    expect(during.status).toBe("running");
    expect(during.summary).toBeUndefined();
    expect(service.bundle(c.id).case.status).toBe("in_progress");

    release();
    const result = await pending;
    expect(result.status).toBe("done");
    expect(result.summary).toBeTruthy();
    expect(result.scorecard!.length).toBeGreaterThan(0);
  });

  it("ошибка одного агента не уничтожает результаты остальных", async () => {
    const provider = new SpyProvider();
    provider.failNext("agent:finance", new AIError("server", "500"));
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await Promise.all(AGENT_IDS.map((id) => service.runAgent(c.id, id)));
    const analyses = service.bundle(c.id).analyses;
    expect(analyses.filter((a) => a.status === "done")).toHaveLength(8);
    const failed = analyses.find((a) => a.agentId === "finance")!;
    expect(failed.status).toBe("error");
    expect(failed.error).toMatch(/провайдера/);
    expect(failed.summary).toBeUndefined();
  });

  it("повтор одного агента не перезапускает остальных", async () => {
    const provider = new SpyProvider();
    provider.failNext("agent:risk", new AIError("timeout"));
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await Promise.all(AGENT_IDS.map((id) => service.runAgent(c.id, id)));
    provider.calls = [];

    const plan = planCourt(service.bundle(c.id), false);
    expect(plan.pendingAgents).toEqual(["risk"]);
    for (const id of plan.pendingAgents) await service.runAgent(c.id, id);
    expect(provider.calls).toEqual(["agent:risk"]);
    expect(service.bundle(c.id).analyses.every((a) => a.status === "done")).toBe(true);
  });

  it("готовый результат без force не пересчитывается (нет повторного платного вызова)", async () => {
    const provider = new SpyProvider();
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await service.runAgent(c.id, "tech");
    await service.runAgent(c.id, "tech");
    expect(provider.calls).toEqual(["agent:tech"]);
    await service.runAgent(c.id, "tech", { force: true });
    expect(provider.calls).toEqual(["agent:tech", "agent:tech"]);
  });

  it("одновременный повторный запуск того же агента отклоняется", async () => {
    const provider = new SpyProvider();
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    const first = service.runAgent(c.id, "growth");
    await expect(service.runAgent(c.id, "growth")).rejects.toThrow(/уже анализирует/);
    await first;
    expect(provider.calls).toEqual(["agent:growth"]);
  });

  it("восстановление: прерванный «running» считается ошибкой и может быть продолжен", async () => {
    const { service, repo } = makeService({ staleMs: -1 });
    const c = service.createCase(IDEA);
    repo.tryStartAgent(c.id, 1, "product", "test"); // сервер «упал» во время вызова
    const a = service.bundle(c.id).analyses.find((x) => x.agentId === "product")!;
    expect(a.status).toBe("error");
    expect(a.error).toMatch(/прерван/);
    const plan = planCourt(service.bundle(c.id), false);
    expect(plan.pendingAgents).toContain("product");
    expect((await service.runAgent(c.id, "product")).status).toBe("done");
  });
});

describe("ошибки AI-провайдера", () => {
  it("без настроенного провайдера этапы не запускаются и ничего не помечается «в работе»", async () => {
    const { service } = makeService({ provider: null });
    const c = service.createCase(IDEA);
    await expect(service.runAgent(c.id, "market")).rejects.toMatchObject({ status: 503 });
    const b = service.bundle(c.id);
    expect(b.analyses).toHaveLength(0);
    expect(b.case.status).toBe("draft");
  });

  it("временные ошибки повторяются ограниченное число раз", async () => {
    const provider = new SpyProvider();
    provider.failNext("agent:market", new AIError("rate_limit"), new AIError("network"));
    const { service } = makeService({ provider, retries: 2 });
    const c = service.createCase(IDEA);
    // ускоряем задержку между повторами
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, _ms?: number) => realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const a = await service.runAgent(c.id, "market");
      expect(a.status).toBe("done");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(provider.calls).toEqual(["agent:market", "agent:market", "agent:market"]);
  });

  it("ошибки авторизации не повторяются и показываются пользователю", async () => {
    const provider = new SpyProvider();
    provider.failNext("agent:market", new AIError("auth"));
    const { service } = makeService({ provider, retries: 3 });
    const c = service.createCase(IDEA);
    const a = await service.runAgent(c.id, "market");
    expect(a.status).toBe("error");
    expect(a.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(provider.calls).toHaveLength(1);
  });

  it("ошибка судьи сохраняется как состояние этапа, заключения агентов остаются", async () => {
    const provider = new SpyProvider();
    provider.failNext("verdict", new AIError("refusal"));
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await expect(runFullCourt(service, c.id)).rejects.toThrow(/отказалась/);
    const b = service.bundle(c.id);
    expect(b.stages.verdict).toBe("error");
    expect(b.verdict).toBeNull();
    expect(b.analyses.filter((a) => a.status === "done")).toHaveLength(9);
    // повтор только вердикта
    provider.calls = [];
    await service.runVerdict(c.id);
    expect(provider.calls).toEqual(["verdict"]);
  });
});

describe("перекрёстная критика и вердикт", () => {
  it("рассматривает противоречия между защитой и обвинением", async () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    await Promise.all(AGENT_IDS.map((id) => service.runAgent(c.id, id)));
    const issues = await service.runCrossExam(c.id);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(4);
    expect(issues[0]).toMatchObject({ originalAgentId: "advocate", counterAgentId: "prosecutor" });
  });

  it("перекрёстная критика отбрасывает выдуманных агентов и ограничивает число вопросов", async () => {
    const inner = new FakeProvider({ latencyMs: 0 });
    const provider: AIProvider = {
      id: "fake", label: "t", paid: false, model: null,
      async generate<T>(req: AIRequest<T>) {
        if (req.input.task !== "cross_exam") return inner.generate(req);
        const issue = (o: string, c: string) => ({
          issue: "x", originalAgentId: o, originalArgument: "a", counterAgentId: c, counterArgument: "b",
          resolution: "r", impact: "high", resolved: false,
        });
        return req.schema.parse({
          issues: [issue("advocate", "ghost"), issue("advocate", "advocate"), ...Array(6).fill(issue("market", "finance"))],
        });
      },
    };
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await Promise.all(AGENT_IDS.map((id) => service.runAgent(c.id, id)));
    const issues = await service.runCrossExam(c.id);
    expect(issues).toHaveLength(4);
    expect(issues.every((i) => i.originalAgentId === "market")).toBe(true);
  });

  it("формирует полный вердикт по 10 критериям с объяснимым общим баллом", async () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    const v = await runFullCourt(service, c.id);
    expect(v.scores).toHaveLength(10);
    expect(v.overallScore).toBe(computeOverallScore(v.scores));
    expect(v.reasoning.length).toBeGreaterThan(20);
    expect(v.isPreliminary).toBe(false);
    expect(v.risks.length).toBeLessThanOrEqual(3);
    const b = service.bundle(c.id);
    expect(b.actionPlan?.nextAction).toBe(v.nextStep);
    expect(["approved", "conditional", "rework", "prison"]).toContain(b.case.status);
    expect(b.case.lastReviewedAt).not.toBeNull();
  });

  it("без всех заключений вердикт выносится только явно как предварительный", async () => {
    const provider = new SpyProvider();
    provider.failNext("agent:finance", new AIError("server"));
    provider.failNext("agent:growth", new AIError("server"));
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await Promise.all(AGENT_IDS.map((id) => service.runAgent(c.id, id)));
    await service.runCrossExam(c.id);
    await expect(service.runVerdict(c.id)).rejects.toThrow(/Не все агенты/);
    const v = await service.runVerdict(c.id, { allowPartial: true });
    expect(v.isPreliminary).toBe(true);
    expect(v.missingAgents.sort()).toEqual(["finance", "growth"]);
    expect(v.unknowns.join(" ")).toMatch(/Не получены заключения 2 из 9/);
  });

  it("судья не выдаёт неподтверждённые предположения за факты", async () => {
    const inner = new FakeProvider({ latencyMs: 0 });
    const provider: AIProvider = {
      id: "fake", label: "t", paid: false, model: null,
      async generate<T>(req: AIRequest<T>) {
        const out = (await inner.generate(req)) as Record<string, unknown>;
        if (req.input.task === "agent") {
          out.claims = [
            { statement: "Рынок вырос на 300% за год", kind: "fact", evidenceIds: [] },
            { statement: "Есть конкурент", kind: "fact", evidenceIds: ["E1"] },
          ];
        }
        return out as T;
      },
    };
    const search: SearchProvider = {
      id: "tavily",
      async search(q) {
        return [{ title: `Результат: ${q}`, url: `https://example.com/${encodeURIComponent(q)}`, snippet: "…" }];
      },
    };
    const { service } = makeService({ provider, search });
    const c = service.createCase(IDEA);
    const v = await runFullCourt(service, c.id);
    const b = service.bundle(c.id);
    expect(b.evidence[0]).toMatchObject({ ref: "E1", sourceUrl: expect.stringMatching(/^https:/) });
    expect(b.evidence[0].checkedAt).toBeTruthy();
    for (const a of b.analyses) {
      expect(a.claims!.find((cl) => cl.statement.startsWith("Рынок"))!.kind).toBe("assumption");
      expect(a.claims!.find((cl) => cl.statement === "Есть конкурент")!.kind).toBe("fact");
    }
    expect(v.downgradedClaims).toBe(9);
    expect(v.evidenceUsed).toBe(b.evidence.length);
  });

  it("без веб-поиска дело явно помечает отсутствие проверки", async () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    const v = await runFullCourt(service, c.id);
    expect(v.unknowns.join(" ")).toMatch(/веб-поиском/);
    expect(service.bundle(c.id).stages.evidence).toBe("skipped");
    expect(buildReport(service.bundle(c.id))).toMatch(/Независимая проверка актуальных данных через веб-поиск не проводилась/);
  });
});

/** Провайдер, судья которого всегда отклоняет идею. */
function rejectingProvider(): AIProvider & { calls: number } {
  const inner = new FakeProvider({ latencyMs: 0 });
  return {
    id: "fake", label: "t", paid: false, model: null, calls: 0,
    async generate<T>(req: AIRequest<T>) {
      this.calls++;
      const out = (await inner.generate(req)) as Record<string, unknown>;
      if (req.input.task === "verdict") {
        out.decision = "rejected";
        out.conditionsForReview = ["Появятся подтверждённые предзаказы"];
      }
      return out as T;
    },
  };
}

describe("Тюрьма идей и пересмотр", () => {
  it("отклонённая идея попадает в тюрьму и не удаляется", async () => {
    const provider = rejectingProvider();
    const { service, db } = makeService({ provider });
    const c = service.createCase(IDEA);
    await runFullCourt(service, c.id);
    const b = service.bundle(c.id);
    expect(b.case.status).toBe("prison");
    expect(b.analyses).toHaveLength(9);
    expect(b.events.some((e) => e.eventType === "imprisoned")).toBe(true);
    const prison = service.list({ status: "prison" });
    expect(prison).toHaveLength(1);
    expect(prison[0]).toMatchObject({ id: c.id, decision: "rejected", conditionsForReview: ["Появятся подтверждённые предзаказы"] });
    expect(service.list({ status: "approved" })).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM cases").get() as { n: number }).n).toBe(1);
  });

  it("повторное рассмотрение требует оснований и открывает новое заседание, сохраняя историю", async () => {
    const provider = rejectingProvider();
    const { service, db } = makeService({ provider });
    const c = service.createCase(IDEA);
    await runFullCourt(service, c.id);

    expect(() => service.reopen(c.id, { newGrounds: "" })).toThrow();
    service.reopen(c.id, { newGrounds: "Собрал 40 заявок на лендинге за неделю без рекламы" });

    const b = service.bundle(c.id);
    expect(b.case.round).toBe(2);
    expect(b.case.status).toBe("in_progress");
    expect(b.verdict).toBeNull();
    expect(b.analyses).toHaveLength(0);
    expect(b.previousVerdicts).toHaveLength(1);
    expect(b.case.optionalContext.comments).toMatch(/40 заявок/);
    expect(b.events.map((e) => e.eventType)).toContain("reopened");
    // материалы первого заседания на месте
    expect((db.prepare("SELECT COUNT(*) AS n FROM agent_analyses WHERE round = 1").get() as { n: number }).n).toBe(9);
    expect(planCourt(b, false).pendingAgents).toHaveLength(9);
  });

  it("нельзя пересматривать дело, по которому ещё нет решения", () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    expect(() => service.reopen(c.id, { newGrounds: "Новые данные интервью с пользователями" })).toThrow(/ещё не рассмотрено/);
  });

  it("после вердикта нельзя запустить агентов без пересмотра", async () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    await runFullCourt(service, c.id);
    await expect(service.runAgent(c.id, "market", { force: true })).rejects.toThrow(/Вердикт уже вынесен/);
  });
});

describe("архив и история", () => {
  it("старое дело открывается без повторного вызова модели", async () => {
    const provider = new SpyProvider();
    const { service } = makeService({ provider });
    const c = service.createCase(IDEA);
    await runFullCourt(service, c.id);
    const callsAfterCourt = provider.calls.length;
    const b = service.bundle(c.id);
    const report = buildReport(b);
    service.list({ query: "питан" });
    expect(provider.calls.length).toBe(callsAfterCourt);
    expect(b.verdict).not.toBeNull();
    for (let i = 1; i <= 17; i++) expect(report).toContain(`## ${i}.`);
  });

  it("поиск по названию и фильтр по статусу", async () => {
    const { service } = makeService();
    service.createCase(IDEA);
    service.createCase({ ...IDEA, title: "Канал о шахматах" });
    expect(service.list({ query: "шахмат" }).map((s) => s.title)).toEqual(["Канал о шахматах"]);
    expect(service.list({ status: "draft" })).toHaveLength(2);
    expect(service.list({ status: "prison" })).toHaveLength(0);
  });

  it("история событий фиксирует все этапы", async () => {
    const { service } = makeService();
    const c = service.createCase(IDEA);
    await runFullCourt(service, c.id);
    const types = service.bundle(c.id).events.map((e) => e.eventType);
    expect(types[0]).toBe("created");
    expect(types).toContain("evidence_skipped");
    expect(types.filter((t) => t === "agent_done")).toHaveLength(9);
    expect(types).toContain("cross_exam_done");
    expect(types).toContain("verdict_done");
  });
});
