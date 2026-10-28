import { describe, expect, it } from "vitest";
import { ClaudeCodeProvider } from "@/server/ai/claudeCode";
import type { AIProvider, AIRequest } from "@/server/ai/types";
import { AGENT_IDS } from "@/shared/agents";
import { FakeProvider } from "./fixtures/fakeProvider";
import { IDEA, makeService } from "./helpers";

/**
 * Живая проверка через подписку: 3 настоящих запроса (рыночный аналитик, перекрёстная критика, судья).
 * Запуск: LIVE_CLAUDE=1 npx vitest run tests/live.test.ts
 */
describe.runIf(process.env.LIVE_CLAUDE === "1")("живой вызов Claude Code", () => {
  it("агент, критика и судья отвечают по схеме", async () => {
    const real = new ClaudeCodeProvider({ bin: process.env.CLAUDE_BIN || "claude", model: process.env.AI_MODEL || "sonnet", effort: "low", timeoutMs: 300_000 });
    const fake = new FakeProvider({ latencyMs: 0 });
    const hybrid: AIProvider = {
      id: "hybrid", label: real.label, paid: false, model: real.model,
      generate<T>(req: AIRequest<T>) {
        const live = (req.input.task === "agent" && req.input.agentId === "market") || req.input.task !== "agent";
        return live ? real.generate(req) : fake.generate(req);
      },
    };
    const { service } = makeService({ provider: hybrid, timeoutMs: 300_000, staleMs: 3_600_000 });
    const c = service.createCase(IDEA);
    const market = await service.runAgent(c.id, "market");
    console.log("market:", market.status, market.error ?? market.summary);
    expect(market.status).toBe("done");
    await Promise.all(AGENT_IDS.filter((id) => id !== "market").map((id) => service.runAgent(c.id, id)));
    const issues = await service.runCrossExam(c.id);
    console.log("cross:", issues.length, issues[0]?.issue);
    expect(service.bundle(c.id).stages.crossExam).toBe("done");
    const v = await service.runVerdict(c.id);
    console.log("verdict:", v.decision, v.overallScore, v.headline);
    expect(v.scores).toHaveLength(10);
    expect(v.reasoning.length).toBeGreaterThan(50);
  }, 900_000);
});
